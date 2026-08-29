/**
 * MIPS Runtime Simulator with Breakpoint & Step-Through Support
 */

import {
	bitsToDouble,
	bitsToSingle,
	CP0_REGISTER_COUNT,
	CP0_STATUS_EXL,
	CP0_STATUS_INITIAL,
	cp0RegisterNumber,
	doubleToBits,
	EXCEPTION_BREAKPOINT,
	EXCEPTION_RESERVED_INSTRUCTION,
	EXCEPTION_SYSCALL,
	FP_CONDITION_FLAG_COUNT,
	FP_REGISTER_COUNT,
	formatDouble,
	formatSingle,
	fpRegisterNumber,
	roundToNearestEven,
	singleToBits,
} from './coprocessor'
import { decode, type Decoded } from './decoder'
import { formatWordDigits, memoryKey } from './format'
import { FileTable, STDERR, STDOUT } from './files'
import type { ExecutionObserver } from './observer'
import { RandomStreams } from './random'
import { REGISTER_NAMES } from './registers'
import type { CallFrame, ExecutionSnapshot, KeyboardDisplayState, MemoryUndoEntry, MipsInstruction, MipsProgram, PendingInput, Registers, SimulatorState } from './types'

/**
 * How far along a delayed branch is: registered by the branch itself, triggered
 * once its delay slot is the instruction in hand (DelayedBranch.java).
 */
type DelayState = 'none' | 'registered' | 'triggered'

/** THRAX enters a `.ktext` exception handler here, when the program defines one. */
const EXCEPTION_HANDLER_ADDRESS = 0x80000180

/** How a message dialog labels itself, by the type in `$a1`. */
const DIALOG_LABELS: Record<number, string> = { 0: 'Error: ', 1: '', 2: 'Warning: ', 3: 'Question: ' }

const DIALOG_OK = 0
const DIALOG_BAD_INPUT = -1
const DIALOG_CANCELLED = -2

/** A note the MIDI syscalls ask for; the browser adapter turns it into sound. */
export interface MidiNote {
	pitch: number
	durationMs: number
	instrument: number
	volume: number
}

export interface MidiPlayer {
	play(note: MidiNote): void
}

/**
 * Runaway-loop guard.  This is a budget per `run`, not a lifetime total, so
 * continuing a paused program picks up with a fresh budget.
 */
const INSTRUCTION_LIMIT = 1_000_000

/** Instructions run between yields to the browser. */
const DEFAULT_BATCH_SIZE = 20_000

/** Redraws per second when execution is paced, which sets the batch size. */
const ANIMATION_FRAMES_PER_SECOND = 30

/** Longest a paced run sleeps without looking at the speed control again. */
const FRAME_SLICE_MS = 50

/** How much of a stalled run a paced run will make up once it resumes. */
const MAX_CATCH_UP_SECONDS = 0.25

const RECEIVER_CONTROL = 0xffff0000
const RECEIVER_DATA = 0xffff0004
const TRANSMITTER_CONTROL = 0xffff0008
const TRANSMITTER_DATA = 0xffff000c

export class MipsSimulator {
	machineCode: number[]
	program: MipsProgram
	registers: Registers
	memory: Map<number, number>
	pc: number
	hi: number
	lo: number
	console: string
	running: boolean
	halted: boolean
	paused: boolean
	instructionCount: number
	/** Source-level metadata for the debugger, keyed by address. */
	addressToInstructionMap: Map<number, number>
	/** Decoded form of each executed word, dropped when that word is written. */
	decodeCache: Map<number, Decoded | null>
	/** Where the current instruction leaves the program counter. */
	nextPc: number
	/** Memory the running instruction has overwritten, for stepping back. */
	memoryUndo: MemoryUndoEntry[]
	/** Open files for syscalls 13-16, held in memory for the run. */
	files: FileTable
	/** Pseudo-random streams for syscalls 40-44. */
	random: RandomStreams
	/** Syscall 32 and 33 ask execution to wait; the run loop honours this. */
	pendingSleepMs: number
	/** The code syscall 17 exited with, or null while the program is running. */
	exitCode: number | null
	/** Nothing attaches a player, so the MIDI syscalls run silently. */
	midi: MidiPlayer | null
	/** Wall-clock source for syscall 30, replaceable so tests stay deterministic. */
	clock: () => number
	/** Instructions per second while running, or null to run flat out. */
	speed: number | null
	/** Addresses a paced run animates; null paces every instruction. */
	pacedAddresses: Set<number> | null
	/** Called after each batch so a paced run can be watched. */
	onProgress: (() => void) | null
	/** Tools watching this run.  Empty is the fast path. */
	observers: ExecutionObserver[]
	breakpoints: Set<number>
	executionHistory: ExecutionSnapshot[]
	maxHistorySize: number
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	heapPointer: number
	keyboardDisplay: KeyboardDisplayState
	/** Coprocessor 1 register file, held as raw words. */
	fpRegisters: number[]
	fpConditionFlags: boolean[]
	/** Coprocessor 0 register file; THRAX uses vaddr, status, cause, and epc. */
	cp0Registers: number[]
	/**
	 * THRAX's delayed branching setting, off by default (Settings.java:130).  On,
	 * the instruction after a branch or jump runs before control transfers.
	 */
	delayedBranching: boolean
	/** Where a pending delayed branch is going, and how close it is to landing. */
	delayState: DelayState
	delayedTarget: number

	constructor(machineCode: number[], program: MipsProgram) {
		this.machineCode = machineCode
		this.program = program
		this.registers = this.initializeRegisters()
		// Sparse, word-addressed virtual memory allows normal THRAX data and stack
		// addresses (for example 0x10010000 and 0x7fffeffc) without allocating a
		// multi-gigabyte browser array.
		this.memory = new Map()
		this.pc = this.entryAddress()
		this.hi = 0
		this.lo = 0
		this.console = ''
		this.running = false
		this.halted = false
		this.paused = false
		this.instructionCount = 0
		this.addressToInstructionMap = new Map()
		this.decodeCache = new Map()
		this.nextPc = this.pc
		this.memoryUndo = []
		this.files = new FileTable()
		this.random = new RandomStreams()
		this.pendingSleepMs = 0
		this.exitCode = null
		this.midi = null
		this.clock = () => Date.now()
		this.speed = null
		this.pacedAddresses = null
		this.onProgress = null
		this.observers = []
		this.breakpoints = new Set() // Set of addresses with breakpoints
		this.executionHistory = [] // Track recent instructions
		this.maxHistorySize = 100
		this.callStack = []
		this.pendingInput = null
		this.heapPointer = 0x10040000
		this.keyboardDisplay = { queuedInput: '', displayOutput: '' }
		this.fpRegisters = new Array(FP_REGISTER_COUNT).fill(0)
		this.fpConditionFlags = new Array(FP_CONDITION_FLAG_COUNT).fill(false)
		this.cp0Registers = new Array(CP0_REGISTER_COUNT).fill(0)
		this.cp0Registers[12] = CP0_STATUS_INITIAL
		this.delayedBranching = false
		this.delayState = 'none'
		this.delayedTarget = 0
		this.registers['$pc'] = this.pc
		this.buildAddressMap()
		this.loadTextSegment()
		this.loadDataSegment()
	}

	initializeRegisters(): Registers {
		return {
			$zero: 0,
			$at: 0,
			$v0: 0,
			$v1: 0,
			$a0: 0,
			$a1: 0,
			$a2: 0,
			$a3: 0,
			$t0: 0,
			$t1: 0,
			$t2: 0,
			$t3: 0,
			$t4: 0,
			$t5: 0,
			$t6: 0,
			$t7: 0,
			$s0: 0,
			$s1: 0,
			$s2: 0,
			$s3: 0,
			$s4: 0,
			$s5: 0,
			$s6: 0,
			$s7: 0,
			$t8: 0,
			$t9: 0,
			$k0: 0,
			$k1: 0,
			$gp: 0x10008000,
			$sp: 0x7fffeffc,
			$fp: 0,
			$ra: 0,
			$pc: 0x00400000,
			$hi: 0,
			$lo: 0,
		}
	}

	/** Execution starts at `main` when the program defines it, as in THRAX. */
	entryAddress(): number {
		const main = this.program.labels?.get('main')
		if (main !== undefined) return main
		const first = this.program.instructions.find((instruction) => (instruction.segment ?? 'text') === 'text')
		return first?.address ?? 0x00400000
	}

	/** Instructions live in .text or .ktext, so they are indexed by their own address. */
	buildAddressMap() {
		this.program.instructions.forEach((instruction, index) => {
			if (instruction.address !== null) this.addressToInstructionMap.set(instruction.address, index)
		})
	}

	/** Assembled words are readable memory, so loads and the memory view see them. */
	loadTextSegment() {
		this.machineCode.forEach((word, index) => {
			const address = this.program.instructions[index]?.address
			if (address !== null && address !== undefined) this.memory.set(address >>> 2, word >>> 0)
		})
	}

	loadDataSegment() {
		for (const entry of this.program.data || []) {
			let address = entry.address
			for (const item of entry.bytes) {
				if (typeof item === 'number') {
					this.writeMemory(address++, item, 1)
					continue
				}
				const target = item.value
				const base = target.type === 'label' ? this.program.labels.get(target.value) : target.value
				if (base === undefined) throw new Error(`Undefined label: ${target.value}`)
				// `.word arr+4` stores the label address plus the expression constant.
				const value = base + (target.type === 'label' ? target.offset ?? 0 : 0)
				this.writeMemory(address, value, item.width)
				address += item.width
			}
		}
	}

	async run(batchSize?: number) {
		await this.runUntil(() => false, batchSize)
	}

	/**
	 * How many instructions to run before handing control back.  A paced run
	 * aims for a steady redraw rate, so slow speeds step one instruction at a
	 * time and fast ones still yield often enough to stay responsive.
	 */
	batchSize(): number {
		if (this.speed === null) return DEFAULT_BATCH_SIZE
		return Math.max(1, Math.round(this.speed / ANIMATION_FRAMES_PER_SECOND))
	}

	/** The pause that holds a paced run to `speed` instructions per second. */
	batchDelayMs(batchSize: number): number {
		return this.speed === null ? 0 : (batchSize / this.speed) * 1000
	}

	/**
	 * Waits out a frame in slices, so moving the speed control or pausing is felt
	 * within a slice rather than after a whole slow frame.
	 */
	async waitFrame(ms: number) {
		const deadline = performance.now() + ms
		const speed = this.speed
		while (this.running && !this.halted && this.speed === speed) {
			const remaining = deadline - performance.now()
			if (remaining <= 0) return
			await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, FRAME_SLICE_MS)))
		}
	}

	/** Runs until `shouldStop()` holds after an instruction, a breakpoint is hit, or execution ends. */
	async runUntil(shouldStop: () => boolean, fixedBatchSize?: number) {
		this.running = true
		this.paused = false
		const budget = this.instructionCount + INSTRUCTION_LIMIT
		// Timers overshoot, so a paced run measures the clock and makes up what it
		// owes on the next pass instead of falling behind the speed that was asked for.
		let lastTick = performance.now()
		let owed = 0

		try {
			while (this.running && !this.halted && this.instructionCount < budget) {
				const frameStarted = performance.now()
				// Read every pass: the speed control moves while a run is going.
				const batchSize = fixedBatchSize ?? this.batchSize()
				const frameMs = this.batchDelayMs(batchSize)
				let allowance = batchSize
				if (this.speed === null) {
					owed = 0
					lastTick = frameStarted
				} else {
					const arrears = ((frameStarted - lastTick) * this.speed) / 1000
					// A long stall (a hidden tab, a slow syscall) must not burst afterwards.
					owed = Math.min(owed + arrears, this.speed * MAX_CATCH_UP_SECONDS)
					lastTick = frameStarted
					allowance = Math.max(1, Math.floor(owed))
				}
				let executed = 0
				while (this.running && !this.halted && this.instructionCount < budget && executed < allowance) {
					if (this.breakpoints.has(this.pc)) {
						this.paused = true
						this.running = false
						break
					}
					this.step()
					if (shouldStop()) {
						this.paused = true
						this.running = false
						break
					}
					// A word the editor cannot point at gets no frame of its own, so a
					// paced run animates the same instructions stepping would stop on.
					if (this.speed !== null && this.pacedAddresses && !this.halted && !this.pacedAddresses.has(this.pc)) continue
					executed++
				}
				owed -= executed
				this.onProgress?.()
				if (this.pendingSleepMs > 0) {
					const delay = this.pendingSleepMs
					this.pendingSleepMs = 0
					await new Promise((resolve) => setTimeout(resolve, delay))
					// A syscall sleep is the program's own wait, not time to make up.
					lastTick = performance.now()
				}
				if (this.running && !this.halted) {
					await this.waitFrame(Math.max(0, frameMs - (performance.now() - frameStarted)))
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			this.console += `\nError: ${message}\n`
			this.halted = true
		}

		if (this.instructionCount >= budget && !this.halted) {
			this.paused = true
			this.console += `\nExecution paused after ${INSTRUCTION_LIMIT.toLocaleString()} instructions. Continue to keep going.\n`
		}

		this.running = false
	}

	/**
	 * Fetches the word at the program counter, decodes it, and runs it.  Nothing
	 * here consults the parsed program, so a jump into data or a word the program
	 * wrote itself executes exactly like assembled text.
	 */
	step() {
		if (this.halted || this.pendingInput) return

		// Untouched memory is not code; reaching it means execution ran off the end.
		if (!this.memory.has(this.pc >>> 2)) {
			this.halted = true
			return
		}

		const decoded = this.decodeAt(this.pc)

		const snapshot = this.createSnapshot(this.instructionAt(this.pc))
		// Memory writes from here on belong to this instruction.
		this.memoryUndo = snapshot.memoryUndo
		this.executionHistory.push(snapshot)
		if (this.executionHistory.length > this.maxHistorySize) {
			this.executionHistory.shift()
		}

		if (decoded === null) {
			this.signalException(EXCEPTION_RESERVED_INSTRUCTION)
			throw new Error(`Undecodable instruction 0x${formatWordDigits(this.memory.get(this.pc >>> 2) ?? 0)}`)
		}

		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onInstruction?.(this.pc, decoded)
		}

		this.nextPc = (this.pc + 4) | 0
		this.execute(decoded)
		if (this.pendingInput) return
		this.pc = this.nextPc
		// A branch registered here lands after the next instruction, its delay
		// slot, has run (Simulator.java:388).
		if (this.delayState === 'triggered') {
			this.pc = this.delayedTarget
			this.delayState = 'none'
		} else if (this.delayState === 'registered') {
			this.delayState = 'triggered'
		}
		this.registers['$pc'] = this.pc
		this.instructionCount++
	}

	stepBack() {
		const snapshot = this.executionHistory.pop()
		if (!snapshot) return false

		this.registers = { ...snapshot.registers }
		this.undoMemoryWrites(snapshot.memoryUndo)
		this.console = snapshot.console
		this.pc = snapshot.pc
		this.hi = snapshot.hi
		this.lo = snapshot.lo
		this.instructionCount = snapshot.instructionCount
		this.halted = snapshot.halted
		this.callStack = snapshot.callStack.map((frame) => ({ ...frame }))
		this.pendingInput = null
		this.heapPointer = snapshot.heapPointer
		this.keyboardDisplay = { ...snapshot.keyboardDisplay }
		this.fpRegisters = [...snapshot.fpRegisters]
		this.fpConditionFlags = [...snapshot.fpConditionFlags]
		this.cp0Registers = [...snapshot.cp0Registers]
		this.delayState = snapshot.delayState
		this.delayedTarget = snapshot.delayedTarget
		this.memoryUndo = []
		this.paused = true
		this.running = false
		return true
	}

	/** Puts back the words an instruction overwrote, most recent write first. */
	undoMemoryWrites(entries: MemoryUndoEntry[]) {
		for (let index = entries.length - 1; index >= 0; index--) {
			const { wordAddress, value } = entries[index]
			if (value === undefined) this.memory.delete(wordAddress)
			else this.memory.set(wordAddress, value)
			// The restored word may decode differently than the one just undone.
			this.decodeCache.delete(wordAddress << 2)
		}
	}

	createSnapshot(instruction: MipsInstruction | null): ExecutionSnapshot {
		return {
			address: this.pc,
			instruction,
			registers: { ...this.registers },
			memoryUndo: [],
			console: this.console,
			pc: this.pc,
			hi: this.hi,
			lo: this.lo,
			instructionCount: this.instructionCount,
			halted: this.halted,
			paused: this.paused,
			callStack: this.callStack.map((frame) => ({ ...frame })),
			heapPointer: this.heapPointer,
			keyboardDisplay: { ...this.keyboardDisplay },
			fpRegisters: [...this.fpRegisters],
			fpConditionFlags: [...this.fpConditionFlags],
			cp0Registers: [...this.cp0Registers],
			delayState: this.delayState,
			delayedTarget: this.delayedTarget,
		}
	}

	async stepOver() {
		// Skip over function calls
		{
			const decoded = this.decodeAt(this.pc)
			if (decoded?.op === 'JAL' || decoded?.op === 'JALR') {
				// Set a breakpoint at the next instruction
				const currentAddress = this.pc
				const restoreCurrentBreakpoint = this.breakpoints.delete(currentAddress)
				const nextAddr = this.pc + 4
				this.breakpoints.add(nextAddr)
				await this.run()
				if (restoreCurrentBreakpoint) this.breakpoints.add(currentAddress)
				this.breakpoints.delete(nextAddr)
				return
			}
		}
		this.step()
	}

	/** Runs until the current subroutine returns (call depth drops below the current depth). */
	async stepToReturn() {
		const targetDepth = this.callStack.length
		if (targetDepth === 0) {
			await this.run()
			return
		}
		await this.runUntil(() => this.callStack.length < targetDepth)
	}

	async continue() {
		this.paused = false
		await this.run()
	}

	addBreakpoint(address) {
		this.breakpoints.add(address)
	}

	removeBreakpoint(address) {
		this.breakpoints.delete(address)
	}

	toggleBreakpoint(address) {
		if (this.breakpoints.has(address)) {
			this.removeBreakpoint(address)
			return false
		} else {
			this.addBreakpoint(address)
			return true
		}
	}

	getBreakpoints() {
		return Array.from(this.breakpoints)
	}

	getCallStack() {
		return this.callStack.map((frame) => ({ ...frame }))
	}

	getExecutionHistory() {
		return this.executionHistory
	}

	/** The parsed instruction assembled to `address`, when the debugger has one. */
	instructionAt(address: number): MipsInstruction | null {
		const index = this.addressToInstructionMap.get(address)
		return index === undefined ? null : this.program.instructions[index] ?? null
	}

	/** The word at `address`, decoded, cached until that word is overwritten. */
	decodeAt(address: number): Decoded | null {
		const cached = this.decodeCache.get(address)
		if (cached !== undefined) return cached
		const decoded = decode(this.memory.get(address >>> 2) ?? 0)
		this.decodeCache.set(address, decoded)
		return decoded
	}

	readReg(number: number): number {
		return this.registers[REGISTER_NAMES[number]] | 0
	}

	writeReg(number: number, value: number) {
		if (number !== 0) this.registers[REGISTER_NAMES[number]] = value | 0
	}

	/** Branches are relative to the instruction after this one. */
	branch(offset: number) {
		this.transferTo((this.pc + 4 + offset * 4) | 0)
	}

	/** Takes a conditional branch or not, and tells the observers which. */
	conditionalBranch(taken: boolean, offset: number) {
		const target = (this.pc + 4 + offset * 4) | 0
		if (taken) this.transferTo(target)
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onBranch?.(this.pc, taken, target)
		}
	}

	/**
	 * Redirects execution, immediately or after the delay slot.  Registering
	 * keeps the target of the branch already pending, as THRAX does, so a branch
	 * inside a delay slot does not steal the transfer.
	 */
	transferTo(target: number) {
		if (!this.delayedBranching) {
			this.nextPc = target
			return
		}
		if (this.delayState === 'none') this.delayedTarget = target
		this.delayState = 'registered'
	}

	/** A jump keeps the top four bits of the address it came from. */
	jumpTarget(index: number): number {
		return ((((this.pc + 4) & 0xf0000000) >>> 0) | (index << 2)) >>> 0
	}

	execute(decoded: Decoded) {
		const { op, rs, rt, rd, shamt, imm, uimm } = decoded

		try {
			switch (op) {
				// Arithmetic
				case 'ADD':
				case 'ADDU':
					this.writeReg(rd, (this.readReg(rs) + this.readReg(rt)) | 0)
					return
				case 'SUB':
				case 'SUBU':
					this.writeReg(rd, (this.readReg(rs) - this.readReg(rt)) | 0)
					return
				case 'ADDI':
				case 'ADDIU':
					this.writeReg(rt, (this.readReg(rs) + imm) | 0)
					return
				case 'MUL':
					this.writeReg(rd, Math.imul(this.readReg(rs), this.readReg(rt)))
					return

				// Logical
				case 'AND':
					this.writeReg(rd, this.readReg(rs) & this.readReg(rt))
					return
				case 'OR':
					this.writeReg(rd, this.readReg(rs) | this.readReg(rt))
					return
				case 'XOR':
					this.writeReg(rd, this.readReg(rs) ^ this.readReg(rt))
					return
				case 'NOR':
					this.writeReg(rd, ~(this.readReg(rs) | this.readReg(rt)))
					return
				case 'ANDI':
					this.writeReg(rt, this.readReg(rs) & uimm)
					return
				case 'ORI':
					this.writeReg(rt, this.readReg(rs) | uimm)
					return
				case 'XORI':
					this.writeReg(rt, this.readReg(rs) ^ uimm)
					return

				// Shifts
				case 'SLL':
					this.writeReg(rd, this.readReg(rt) << shamt)
					return
				case 'SRL':
					this.writeReg(rd, this.readReg(rt) >>> shamt)
					return
				case 'SRA':
					this.writeReg(rd, this.readReg(rt) >> shamt)
					return
				case 'SLLV':
					this.writeReg(rd, this.readReg(rt) << (this.readReg(rs) & 31))
					return
				case 'SRLV':
					this.writeReg(rd, this.readReg(rt) >>> (this.readReg(rs) & 31))
					return
				case 'SRAV':
					this.writeReg(rd, this.readReg(rt) >> (this.readReg(rs) & 31))
					return

				// Comparison
				case 'SLT':
					this.writeReg(rd, this.readReg(rs) < this.readReg(rt) ? 1 : 0)
					return
				case 'SLTU':
					this.writeReg(rd, (this.readReg(rs) >>> 0) < (this.readReg(rt) >>> 0) ? 1 : 0)
					return
				case 'SLTI':
					this.writeReg(rt, this.readReg(rs) < imm ? 1 : 0)
					return
				case 'SLTIU':
					// The immediate is sign-extended, then compared as unsigned.
					this.writeReg(rt, (this.readReg(rs) >>> 0) < (imm >>> 0) ? 1 : 0)
					return

				// Multiply and divide
				case 'MULT': {
					const product = BigInt(this.readReg(rs)) * BigInt(this.readReg(rt))
					this.lo = Number(BigInt.asIntN(32, product))
					this.hi = Number(BigInt.asIntN(32, product >> 32n))
					return
				}
				case 'MULTU': {
					const product = BigInt(this.readReg(rs) >>> 0) * BigInt(this.readReg(rt) >>> 0)
					this.lo = Number(BigInt.asIntN(32, product))
					this.hi = Number(BigInt.asIntN(32, product >> 32n))
					return
				}
				case 'DIV': {
					const dividend = this.readReg(rs)
					const divisor = this.readReg(rt)
					if (divisor === 0) return
					// MIPS truncates the quotient toward zero.
					this.lo = (dividend / divisor) | 0
					this.hi = (dividend % divisor) | 0
					return
				}
				case 'DIVU': {
					const dividend = this.readReg(rs) >>> 0
					const divisor = this.readReg(rt) >>> 0
					if (divisor === 0) return
					this.lo = Math.floor(dividend / divisor) | 0
					this.hi = (dividend % divisor) | 0
					return
				}
				case 'MFHI':
					this.writeReg(rd, this.hi)
					return
				case 'MFLO':
					this.writeReg(rd, this.lo)
					return
				case 'MTHI':
					this.hi = this.readReg(rs)
					return
				case 'MTLO':
					this.lo = this.readReg(rs)
					return

				// Load and store
				case 'LW':
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 4))
					return
				case 'LH':
					this.writeReg(rt, (this.readMemory(this.effectiveAddress(rs, imm), 2) << 16) >> 16)
					return
				case 'LHU':
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 2))
					return
				case 'LB':
					this.writeReg(rt, (this.readMemory(this.effectiveAddress(rs, imm), 1) << 24) >> 24)
					return
				case 'LBU':
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 1))
					return
				case 'SW':
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 4)
					return
				case 'SH':
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 2)
					return
				case 'SB':
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 1)
					return

				// THRAX simulates one processor, so the store always succeeds and
				// `ll`/`sc` are `lw`/`sw` with a success code (InstructionSet.java:670).
				case 'LL':
					this.writeReg(rt, this.readMemory(this.effectiveAddress(rs, imm), 4))
					return
				case 'SC':
					this.writeMemory(this.effectiveAddress(rs, imm), this.readReg(rt), 4)
					this.writeReg(rt, 1)
					return

				// Unaligned word transfers.  Each moves the bytes between the
				// effective address and the near end of its word.
				case 'LWL':
				case 'LWR': {
					const address = this.effectiveAddress(rs, imm)
					const towardsLow = op === 'LWL'
					let result = this.readReg(rt)
					for (let i = 0; i <= (towardsLow ? address & 3 : 3 - (address & 3)); i++) {
						const byte = this.readMemory(towardsLow ? address - i : address + i, 1)
						const shift = (towardsLow ? 3 - i : i) * 8
						result = ((result & ~(0xff << shift)) | (byte << shift)) >>> 0
					}
					this.writeReg(rt, result | 0)
					return
				}
				case 'SWL':
				case 'SWR': {
					const address = this.effectiveAddress(rs, imm)
					const towardsLow = op === 'SWL'
					const source = this.readReg(rt) >>> 0
					for (let i = 0; i <= (towardsLow ? address & 3 : 3 - (address & 3)); i++) {
						const shift = (towardsLow ? 3 - i : i) * 8
						this.writeMemory(towardsLow ? address - i : address + i, (source >>> shift) & 0xff, 1)
					}
					return
				}
				case 'LUI':
					this.writeReg(rt, uimm << 16)
					return

				// Branches
				case 'BEQ':
					this.conditionalBranch(this.readReg(rs) === this.readReg(rt), imm)
					return
				case 'BNE':
					this.conditionalBranch(this.readReg(rs) !== this.readReg(rt), imm)
					return
				case 'BGEZ':
					this.conditionalBranch(this.readReg(rs) >= 0, imm)
					return
				case 'BGTZ':
					this.conditionalBranch(this.readReg(rs) > 0, imm)
					return
				case 'BLEZ':
					this.conditionalBranch(this.readReg(rs) <= 0, imm)
					return
				case 'BLTZ':
					this.conditionalBranch(this.readReg(rs) < 0, imm)
					return

				// Jumps
				case 'J':
					this.transferTo(this.jumpTarget(decoded.index))
					return
				case 'JAL':
					this.enterCall(31, this.jumpTarget(decoded.index))
					return
				case 'JALR':
					this.enterCall(rd, this.readReg(rs) >>> 0)
					return
				case 'JR': {
					const target = this.readReg(rs) >>> 0
					if (this.callStack[this.callStack.length - 1]?.returnAddress === target) this.callStack.pop()
					this.transferTo(target)
					return
				}

				case 'SYSCALL':
					this.handleSyscall()
					return

				// THRAX has no trap handler for `break`, so it stops the program
				// (InstructionSet.java:1159).
				case 'BREAK': {
					const code = decoded.index >>> 6
					this.signalException(EXCEPTION_BREAKPOINT)
					throw new Error(code ? `break instruction executed; code = ${code}.` : 'break instruction executed; no code given.')
				}

				// Coprocessor 0
				case 'MFC0':
					this.writeReg(rt, this.cp0Registers[rd] | 0)
					return
				case 'MTC0':
					this.cp0Registers[rd] = this.readReg(rt)
					return
				case 'ERET':
					this.cp0Registers[12] &= ~CP0_STATUS_EXL
					this.nextPc = this.cp0Registers[14] >>> 0
					return

				// Coprocessor 1 moves, loads, stores, and branches
				case 'MFC1':
					this.writeReg(rt, this.fpRegisters[decoded.fs] | 0)
					return
				case 'MTC1':
					this.fpRegisters[decoded.fs] = this.readReg(rt) >>> 0
					return
				case 'LWC1':
					this.fpRegisters[decoded.ft] = this.readMemory(this.effectiveAddress(rs, imm), 4)
					return
				case 'SWC1':
					this.writeMemory(this.effectiveAddress(rs, imm), this.fpRegisters[decoded.ft], 4)
					return
				case 'LDC1': {
					const index = this.evenRegister(decoded.ft)
					const address = this.effectiveAddress(rs, imm)
					this.fpRegisters[index] = this.readMemory(address, 4)
					this.fpRegisters[index + 1] = this.readMemory(address + 4, 4)
					return
				}
				case 'SDC1': {
					const index = this.evenRegister(decoded.ft)
					const address = this.effectiveAddress(rs, imm)
					this.writeMemory(address, this.fpRegisters[index], 4)
					this.writeMemory(address + 4, this.fpRegisters[index + 1], 4)
					return
				}
				// Only condition code 0 is reachable from the supported syntax.
				case 'BC1T':
				case 'BC1F':
					this.conditionalBranch(this.fpConditionFlags[0] === (op === 'BC1T'), imm)
					return
				case 'MOVT':
				case 'MOVF':
					if (this.fpConditionFlags[0] === (op === 'MOVT')) this.writeReg(rd, this.readReg(rs))
					return

				default:
					if (this.executeFpOperation(decoded)) return
					this.signalException(EXCEPTION_RESERVED_INSTRUCTION)
					throw new Error(`Unsupported instruction: ${op}`)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`Error executing ${op}: ${message}`)
		}
	}

	/**
	 * Links `linkRegister` to the following instruction and records the frame.
	 * With delayed branching the link skips the delay slot, which has already
	 * run by the time the call returns (InstructionSet.java:3307).
	 */
	enterCall(linkRegister: number, target: number) {
		const returnAddress = (this.pc + (this.delayedBranching ? 8 : 4)) | 0
		this.writeReg(linkRegister, returnAddress)
		this.callStack.push({ callAddress: this.pc, returnAddress, targetAddress: target })
		this.transferTo(target)
	}

	effectiveAddress(base: number, offset: number): number {
		return (this.readReg(base) + offset) >>> 0
	}

	/** Executes the dotted CP1 mnemonics; returns false for anything else. */
	executeFpOperation(decoded: Decoded): boolean {
		const parts = decoded.op.split('.')
		const { ft, fs, fd } = decoded
		if (parts.length === 2) return this.executeFpArithmetic(parts[0], parts[1], fd, fs, ft)
		if (parts.length === 3 && parts[0] === 'C') return this.executeFpCompare(parts[1], parts[2], fs, ft)
		if (parts.length === 3 && parts[0] === 'CVT') return this.executeFpConvert(parts[1], parts[2], fd, fs)
		if (parts.length === 3 && parts[1] === 'W') return this.executeFpRound(parts[0], parts[2], fd, fs)
		return false
	}

	executeFpArithmetic(operation: string, format: string, fd: number, fs: number, ft: number): boolean {
		if (format !== 'S' && format !== 'D') return false
		const double = format === 'D'
		const read = (index: number) => double ? this.readFpDouble(index) : this.readFpSingle(index)
		const write = (index: number, value: number) => double ? this.writeFpDouble(index, value) : this.writeFpSingle(index, value)

		switch (operation) {
			case 'ADD': write(fd, read(fs) + read(ft)); return true
			case 'SUB': write(fd, read(fs) - read(ft)); return true
			case 'MUL': write(fd, read(fs) * read(ft)); return true
			case 'DIV': write(fd, read(fs) / read(ft)); return true
			case 'SQRT': write(fd, Math.sqrt(read(fs))); return true
			case 'ABS': write(fd, Math.abs(read(fs))); return true
			case 'NEG': write(fd, -read(fs)); return true
			case 'MOV': {
				// A raw copy keeps NaN payloads and signed zeroes intact.
				const target = double ? this.evenRegister(fd) : fd
				const source = double ? this.evenRegister(fs) : fs
				this.fpRegisters[target] = this.fpRegisters[source]
				if (double) this.fpRegisters[target + 1] = this.fpRegisters[source + 1]
				return true
			}
			default: return false
		}
	}

	executeFpCompare(comparison: string, format: string, fs: number, ft: number): boolean {
		const value = this.readFpFormatted(format, fs)
		const other = this.readFpFormatted(format, ft)
		if (value === null || other === null) return false

		const result = comparison === 'EQ' ? value === other
			: comparison === 'LT' ? value < other
				: comparison === 'LE' ? value <= other
					: null
		if (result === null) return false
		this.fpConditionFlags[0] = result
		return true
	}

	executeFpConvert(target: string, source: string, fd: number, fs: number): boolean {
		const value = this.readFpFormatted(source, fs)
		if (value === null) return false

		if (target === 'S') this.writeFpSingle(fd, value)
		else if (target === 'D') this.writeFpDouble(fd, value)
		else if (target === 'W') this.writeFpWord(fd, roundToNearestEven(value))
		else return false
		return true
	}

	executeFpRound(operation: string, format: string, fd: number, fs: number): boolean {
		const value = this.readFpFormatted(format, fs)
		if (value === null) return false

		const rounded = operation === 'ROUND' ? roundToNearestEven(value)
			: operation === 'TRUNC' ? Math.trunc(value)
				: operation === 'CEIL' ? Math.ceil(value)
					: operation === 'FLOOR' ? Math.floor(value)
						: null
		if (rounded === null) return false
		this.writeFpWord(fd, rounded)
		return true
	}

	/** Reads one CP1 operand in the given format, or null for an unknown format. */
	readFpFormatted(format: string, index: number): number | null {
		if (format === 'S') return this.readFpSingle(index)
		if (format === 'D') return this.readFpDouble(index)
		if (format === 'W') return this.readFpWord(index)
		return null
	}

	/** Doubles occupy an even/odd register pair, so the operand must be even. */
	evenRegister(index: number): number {
		if (index % 2 !== 0) throw new Error(`Double-precision operands require an even register, not $f${index}`)
		return index
	}

	readFpWord(index: number): number {
		return this.fpRegisters[index] | 0
	}

	writeFpWord(index: number, value: number) {
		this.fpRegisters[index] = value >>> 0
	}

	readFpSingle(index: number): number {
		return bitsToSingle(this.fpRegisters[index])
	}

	writeFpSingle(index: number, value: number) {
		this.fpRegisters[index] = singleToBits(value)
	}

	readFpDouble(index: number): number {
		const even = this.evenRegister(index)
		return bitsToDouble(this.fpRegisters[even], this.fpRegisters[even + 1])
	}

	writeFpDouble(index: number, value: number) {
		const even = this.evenRegister(index)
		const { low, high } = doubleToBits(value)
		this.fpRegisters[even] = low
		this.fpRegisters[even + 1] = high
	}

	/**
	 * Records a trap in CP0 before it is reported.  There is no kernel text
	 * segment yet, so nothing dispatches to a handler; `eret` still returns to
	 * the recorded EPC for programs that set it themselves.
	 */
	/** Records the exception; returns true when a `.ktext` handler takes over. */
	signalException(code: number, badVirtualAddress?: number): boolean {
		this.cp0Registers[13] = (this.cp0Registers[13] & ~0x7c) | ((code & 0x1f) << 2)
		this.cp0Registers[14] = this.pc
		this.cp0Registers[12] |= CP0_STATUS_EXL
		if (badVirtualAddress !== undefined) this.cp0Registers[8] = badVirtualAddress >>> 0

		if (!this.addressToInstructionMap.has(EXCEPTION_HANDLER_ADDRESS)) return false
		// `step` advances the pc once the instruction returns, so bias the entry.
		this.pc = EXCEPTION_HANDLER_ADDRESS - 4
		return true
	}

	/** A null-terminated string in memory, as the string syscalls read them. */
	readString(address: number, limit = 4096): string {
		let cursor = address >>> 0
		let text = ''
		for (let index = 0; index < limit; index++) {
			const byte = this.readMemory(cursor, 1)
			if (byte === 0) break
			text += String.fromCharCode(byte)
			cursor += 1
		}
		return text
	}

	handleSyscall() {
		const code = this.registers['$v0'] | 0
		const a0 = this.registers['$a0'] | 0
		const a1 = this.registers['$a1'] | 0
		const a2 = this.registers['$a2'] | 0

		switch (code) {
			case 1:
				this.console += a0
				break
			case 4:
				this.console += this.readString(a0 >>> 0)
				break
			case 5:
				this.requestInput({ type: 'integer' })
				break
			case 8:
				this.requestInput({ type: 'string', maximumLength: a1, bufferAddress: a0 >>> 0 })
				break
			case 9:
				this.allocateHeap(a0)
				break
			case 10:
				this.halted = true
				break
			case 11:
				this.console += String.fromCharCode(a0 & 0xff)
				break
			case 12:
				this.requestInput({ type: 'character' })
				break
			case 17:
				this.exitCode = a0
				this.halted = true
				break
			case 2:
				this.console += formatSingle(bitsToSingle(this.fpRegisters[12]))
				break
			case 3:
				this.console += formatDouble(bitsToDouble(this.fpRegisters[12], this.fpRegisters[13]))
				break
			case 6:
				this.requestInput({ type: 'float' })
				break
			case 7:
				this.requestInput({ type: 'double' })
				break

			// File operations.  Descriptors 1 and 2 are the console.
			case 13:
				this.registers['$v0'] = this.files.openFile(this.readString(a0 >>> 0), a1)
				break
			case 14: {
				const bytes = this.files.read(a0, a2)
				if (bytes === -1) {
					this.registers['$v0'] = -1
					break
				}
				for (let index = 0; index < bytes.length; index++) this.writeMemory((a1 >>> 0) + index, bytes[index], 1)
				this.registers['$v0'] = bytes.length
				break
			}
			case 15: {
				const bytes: number[] = []
				for (let index = 0; index < a2; index++) bytes.push(this.readMemory((a1 >>> 0) + index, 1))
				if (a0 === STDOUT || a0 === STDERR) {
					this.console += bytes.map((byte) => String.fromCharCode(byte)).join('')
					this.registers['$v0'] = bytes.length
					break
				}
				this.registers['$v0'] = this.files.write(a0, bytes)
				break
			}
			case 16:
				this.registers['$v0'] = this.files.close(a0)
				break

			case 30: {
				// Milliseconds since the epoch, low half in $a0 and high half in $a1.
				const now = this.clock()
				this.registers['$a0'] = now | 0
				this.registers['$a1'] = Math.floor(now / 0x100000000) | 0
				break
			}
			case 32:
				this.pendingSleepMs = Math.max(0, a0)
				break

			// MIDI.  31 returns at once; 33 waits out the note.
			case 31:
			case 33:
				this.midi?.play({ pitch: a0 & 0x7f, durationMs: Math.max(0, a1), instrument: a2 & 0x7f, volume: this.registers['$a3'] & 0x7f })
				if (code === 33) this.pendingSleepMs = Math.max(0, a1)
				break

			case 34:
				this.console += `0x${(a0 >>> 0).toString(16).padStart(8, '0')}`
				break
			case 35:
				this.console += (a0 >>> 0).toString(2).padStart(32, '0')
				break
			case 36:
				this.console += (a0 >>> 0).toString(10)
				break

			// Pseudo-random streams, one per identifier in $a0.
			case 40:
				this.random.setSeed(a0, a1)
				break
			case 41:
				this.registers['$a0'] = this.random.stream(a0).nextInt()
				break
			case 42:
				if (a1 <= 0) throw new Error(`Random upper bound (${a1}) must be positive`)
				this.registers['$a0'] = this.random.stream(a0).nextIntBounded(a1)
				break
			case 43:
				this.fpRegisters[0] = singleToBits(this.random.stream(a0).nextFloat())
				break
			case 44: {
				const { low, high } = doubleToBits(this.random.stream(a0).nextDouble())
				this.fpRegisters[0] = low
				this.fpRegisters[1] = high
				break
			}

			// Dialogs.  A browser tab has no modal window, so these prompt in the
			// console; the status codes a THRAX program checks are unchanged.
			case 50:
				this.requestInput({ type: 'confirm', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 51:
				this.requestInput({ type: 'integer', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 52:
				this.requestInput({ type: 'float', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 53:
				this.requestInput({ type: 'double', prompt: this.readString(a0 >>> 0), dialog: true })
				break
			case 54:
				this.requestInput({ type: 'string', prompt: this.readString(a0 >>> 0), dialog: true, maximumLength: a2, bufferAddress: a1 >>> 0 })
				break
			case 55:
				this.console += `${DIALOG_LABELS[a1] ?? ''}${this.readString(a0 >>> 0)}\n`
				break
			case 56:
				this.console += `${this.readString(a0 >>> 0)}${a1}\n`
				break
			case 57:
				this.console += `${this.readString(a0 >>> 0)}${formatSingle(bitsToSingle(this.fpRegisters[12]))}\n`
				break
			case 58:
				this.console += `${this.readString(a0 >>> 0)}${formatDouble(bitsToDouble(this.fpRegisters[12], this.fpRegisters[13]))}\n`
				break
			case 59:
				this.console += `${this.readString(a0 >>> 0)}${this.readString(a1 >>> 0)}\n`
				break

			default:
				if (!this.signalException(EXCEPTION_SYSCALL)) throw new Error(`Unsupported syscall: ${code}`)
				break
		}
	}

	allocateHeap(requestedBytes: number) {
		if (requestedBytes < 0) throw new Error(`Heap allocation request (${requestedBytes}) is negative`)
		const address = this.heapPointer
		this.heapPointer = (this.heapPointer + requestedBytes + 3) & ~3
		this.registers['$v0'] = address
	}

	requestInput(request: PendingInput) {
		this.pendingInput = request
		this.paused = true
		this.running = false
	}

	/**
	 * Resumes a program waiting on input.  `cancelled` is how a dialog reports
	 * that the user dismissed it, which THRAX distinguishes from empty input.
	 */
	provideInput(input: string, cancelled = false) {
		const request = this.pendingInput
		if (!request) return false

		if (request.dialog) this.completeDialog(request, input, cancelled)
		else this.completeConsoleInput(request, input)

		this.pendingInput = null
		this.pc += 4
		this.registers['$pc'] = this.pc
		this.instructionCount++
		return true
	}

	completeConsoleInput(request: PendingInput, input: string) {
		if (request.type === 'integer') {
			const value = Number.parseInt(input.trim(), 10)
			this.registers['$v0'] = Number.isNaN(value) ? 0 : value
		} else if (request.type === 'character') {
			this.registers['$v0'] = input.charCodeAt(0) || 0
		} else if (request.type === 'float') {
			this.fpRegisters[0] = singleToBits(Number.parseFloat(input) || 0)
		} else if (request.type === 'double') {
			const { low, high } = doubleToBits(Number.parseFloat(input) || 0)
			this.fpRegisters[0] = low
			this.fpRegisters[1] = high
		} else {
			this.writeInputString(input, request.maximumLength || 0, request.bufferAddress)
		}
	}

	/** Dialog syscalls report an outcome in $a1 alongside the value they read. */
	completeDialog(request: PendingInput, input: string, cancelled: boolean) {
		if (request.type === 'confirm') {
			// 0 yes, 1 no, 2 cancel.
			this.registers['$a0'] = cancelled ? 2 : /^\s*(y|yes|1|true)\s*$/i.test(input) ? 0 : 1
			return
		}

		if (cancelled) {
			this.registers['$a1'] = DIALOG_CANCELLED
			return
		}

		if (request.type === 'string') {
			// A dialog stores exactly what was typed; only syscall 8 adds a newline.
			this.writeInputString(input, request.maximumLength || 0, request.bufferAddress, false)
			this.registers['$a1'] = DIALOG_OK
			return
		}

		const value = request.type === 'integer' ? Number.parseInt(input.trim(), 10) : Number.parseFloat(input.trim())
		if (Number.isNaN(value)) {
			this.registers['$a1'] = DIALOG_BAD_INPUT
			return
		}

		if (request.type === 'integer') this.registers['$a0'] = value | 0
		else if (request.type === 'float') this.fpRegisters[0] = singleToBits(value)
		else {
			const { low, high } = doubleToBits(value)
			this.fpRegisters[0] = low
			this.fpRegisters[1] = high
		}
		this.registers['$a1'] = DIALOG_OK
	}

	writeInputString(input: string, maximumLength: number, bufferAddress?: number, appendNewline = true) {
		if (maximumLength <= 0) return
		const address = (bufferAddress ?? this.registers['$a0']) >>> 0
		const value = input.slice(0, Math.max(0, maximumLength - 1))
		for (let index = 0; index < value.length; index++) {
			this.writeMemory(address + index, value.charCodeAt(index), 1)
		}
		let length = value.length
		if (appendNewline && length < maximumLength - 1) {
			this.writeMemory(address + length, '\n'.charCodeAt(0), 1)
			length++
		}
		this.writeMemory(address + length, 0, 1)
	}

	readMemory(addr: number, size: number): number {
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onMemoryRead?.(addr >>> 0, size)
		}
		let value = 0
		for (let i = 0; i < size; i++) value |= this.readByte((addr + i) >>> 0) << (i * 8)
		return value >>> 0
	}

	writeMemory(addr: number, value: number, size: number) {
		if (this.observers.length > 0) {
			for (const observer of this.observers) observer.onMemoryWrite?.(addr >>> 0, size)
		}
		for (let i = 0; i < size; i++) this.writeByte((addr + i) >>> 0, value >>> (i * 8))
	}

	readByte(addr: number): number {
		if (addr === RECEIVER_CONTROL) return this.keyboardDisplay.queuedInput.length > 0 ? 1 : 0
		if (addr === RECEIVER_DATA) {
			const character = this.keyboardDisplay.queuedInput.charCodeAt(0) || 0
			if (character) this.keyboardDisplay.queuedInput = this.keyboardDisplay.queuedInput.slice(1)
			return character
		}
		if (addr === TRANSMITTER_CONTROL) return 1
		const wordAddr = addr >>> 2
		return ((this.memory.get(wordAddr) || 0) >>> ((addr & 3) * 8)) & 0xff
	}

	writeByte(addr: number, value: number) {
		if (addr === TRANSMITTER_DATA) {
			const character = value & 0xff
			this.keyboardDisplay.displayOutput = character === 12
				? ''
				: this.keyboardDisplay.displayOutput + String.fromCharCode(character)
			return
		}
		if (addr === RECEIVER_CONTROL || addr === RECEIVER_DATA || addr === TRANSMITTER_CONTROL) return
		const wordAddr = addr >>> 2
		const shift = (addr & 3) * 8
		const previous = this.memory.get(wordAddr)
		const oldWord = previous || 0
		const word = ((oldWord & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0
		if (word === oldWord && previous !== undefined) return
		this.memoryUndo.push({ wordAddress: wordAddr, value: previous })
		this.memory.set(wordAddr, word)
		// Self-modifying code: the previous decoding of this word no longer holds.
		this.decodeCache.delete(wordAddr << 2)
	}

	getState(): SimulatorState {
		return {
			registers: { ...this.registers },
			memory: this.getMemoryView(),
			console: this.console,
			pc: this.pc,
			hi: this.hi,
			lo: this.lo,
			instructionCount: this.instructionCount,
			paused: this.paused,
			halted: this.halted,
			callStack: this.getCallStack(),
			pendingInput: this.pendingInput,
			heapPointer: this.heapPointer,
			keyboardDisplay: { ...this.keyboardDisplay },
			fpRegisters: [...this.fpRegisters],
			fpConditionFlags: [...this.fpConditionFlags],
			cp0Registers: [...this.cp0Registers],
		}
	}

	queueKeyboardInput(input: string) {
		this.keyboardDisplay.queuedInput += input
	}

	getMemoryView() {
		const view = {}
		const words = [...this.memory.entries()].sort(([a], [b]) => a - b)
		for (const [wordAddress, value] of words) {
			view[memoryKey(wordAddress * 4)] = value
		}
		return view
	}
}

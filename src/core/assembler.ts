/**
 * MIPS Assembler - Converts assembly code to machine code
 */

import { doubleToBits, fpRegisterNumber, cp0RegisterNumber, singleToBits } from './coprocessor'
import { AssemblyError, at, atInstruction, type SourcePosition } from './diagnostics'
import { Lexer } from './lexer'
import { expandMacros } from './macros'
import { Parser, type ParseResult } from './parser'
import { REGISTER_NAMES, registerNumber } from './registers'
import { buildSourceIndex, EMPTY_SOURCE_INDEX } from './sourceIndex'
import type { Diagnostic, ImmediateArgument, LabelArgument, MipsArgument, MipsInstruction, MipsProgram, TextSegment, TokenData } from './types'

/** Instructions whose two-operand form repeats the destination as a source. */
const TWO_OPERAND_FORMS = new Set([
	'ADD', 'ADDU', 'ADDI', 'ADDIU', 'SUB', 'SUBU', 'SUBI', 'SUBIU',
	'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR', 'MUL', 'MULU',
	'SLT', 'SLTU', 'SLTI', 'SLTIU', 'ROL', 'ROR',
])

/** Instructions taking an `rt, offset(base)` operand pair. */
const LOAD_STORE_NAMES = new Set([
	'LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB',
	'LWL', 'LWR', 'SWL', 'SWR', 'LL', 'SC',
])

const COP0_OPCODE = 0x10
const COP1_OPCODE = 0x11

/** CP1 format field: single, double, and 32-bit integer. */
const FP_FORMAT_CODES: Record<string, number> = { S: 16, D: 17, W: 20 }
const FP_ARITHMETIC_FUNCTIONS: Record<string, number> = { ADD: 0, SUB: 1, MUL: 2, DIV: 3, SQRT: 4, ABS: 5, MOV: 6, NEG: 7 }
const FP_UNARY_OPERATIONS = new Set(['SQRT', 'ABS', 'MOV', 'NEG'])
const FP_CONVERT_FUNCTIONS: Record<string, number> = {
	'ROUND.W': 12,
	'TRUNC.W': 13,
	'CEIL.W': 14,
	'FLOOR.W': 15,
	'CVT.S': 32,
	'CVT.D': 33,
	'CVT.W': 36,
}
const FP_COMPARE_FUNCTIONS: Record<string, number> = { EQ: 50, LT: 60, LE: 62 }
const FP_MEMORY_OPCODES: Record<string, number> = { LWC1: 0x31, LDC1: 0x35, SWC1: 0x39, SDC1: 0x3d }

/** One translation unit; several are assembled together into one program. */
export interface SourceFile { name: string; code: string }

/** What one assembly produced; `program` and `machineCode` stand only when no diagnostic is an error. */
export interface AssembleResult {
	program: MipsProgram
	machineCode: number[]
	diagnostics: Diagnostic[]
}

/** The program of a source that never got as far as being parsed. */
function emptyProgram(): MipsProgram {
	return {
		instructions: [],
		labels: new Map(),
		data: [],
		sourceIndex: EMPTY_SOURCE_INDEX,
	}
}

export interface AssemblerOptions {
	/**
	 * THRAX's delayed branching setting, off by default (Settings.java:130).  It
	 * only reaches the assembler through the pseudo-ops that branch over a delay
	 * slot of their own.
	 */
	delayedBranching?: boolean
}

/** Names an operand in an error message, without dumping its internals. */
function describeArgument(arg: MipsArgument | string | undefined): string {
	if (arg === undefined) return 'nothing'
	if (typeof arg === 'string') return arg
	if (arg.type === 'immediate') return `the value ${arg.value}`
	if (arg.type === 'label') return `the label ${arg.value}`
	if (arg.type === 'string') return 'a string'
	if (arg.type === 'memory') return 'a memory operand'
	return 'that operand'
}

export class Assembler {
	files: SourceFile[]
	/** Files assembled into the program; the rest are reachable by `.include`. */
	entries: SourceFile[]
	program: MipsProgram | null
	machineCode: number[]
	currentAddress: number
	delayedBranching: boolean
	/** Faults found in the source, rather than bugs in the assembler. */
	diagnostics: Diagnostic[]
	/** Instruction being expanded or encoded, which positions its diagnostics. */
	currentInstruction: MipsInstruction | null

	/**
	 * A bare string assembles as a single unnamed file.  Given several files,
	 * all of them are assembled together unless `entryNames` narrows the set.
	 */
	constructor(public source: string | SourceFile[], entryNames?: string[], options: AssemblerOptions = {}) {
		this.files = typeof source === 'string' ? [{ name: '', code: source }] : source
		this.entries = entryNames ? this.files.filter((file) => entryNames.includes(file.name)) : this.files
		this.program = null
		this.machineCode = []
		this.currentAddress = 0x00400000
		this.delayedBranching = options.delayedBranching ?? false
		this.diagnostics = []
		this.currentInstruction = null
	}

	get entryFile(): string {
		return this.entries[0]?.name ?? ''
	}

	/**
	 * A fault in the source is reported, not thrown: the per-instruction passes
	 * carry on past one, so a single assembly names every bad instruction it
	 * finds.  Lexing, macro expansion and parsing still stop at their first
	 * error, since nothing downstream of a broken token stream is trustworthy.
	 */
	assemble(): AssembleResult {
		// Every pass accumulates into a field, so a second call starts clean rather
		// than appending its output to the first one's.
		this.diagnostics = []
		this.machineCode = []
		this.program = null
		this.currentInstruction = null

		let parsed: ParseResult
		try {
			// Lexical analysis, across every file of the program
			const tokens = expandMacros(this.tokenizeFiles())

			// Parse
			parsed = new Parser(tokens).parse()
		} catch (error) {
			this.record(error)
			return { program: emptyProgram(), machineCode: [], diagnostics: this.diagnostics }
		}

		this.program = this.expandPseudoInstructions(parsed)

		// Generate machine code
		this.generateMachineCode()

		this.sortDiagnostics()
		return {
			program: this.program,
			machineCode: this.machineCode,
			diagnostics: this.diagnostics,
		}
	}

	/**
	 * Records a source fault.  Anything else is a bug in the assembler and keeps
	 * propagating, rather than being reported as the user's mistake.
	 */
	record(error: unknown) {
		if (!(error instanceof AssemblyError)) throw error
		const diagnostic = error.diagnostic
		// One fault can surface twice, such as in both halves of an expanded `la`.
		const seen = this.diagnostics.some((existing) =>
			existing.message === diagnostic.message && existing.file === diagnostic.file && existing.line === diagnostic.line)
		if (!seen) this.diagnostics.push(diagnostic)
	}

	/**
	 * Puts the diagnostics in reading order: the passes find them out of order,
	 * since a pseudo-instruction is expanded before anything is encoded.
	 */
	sortDiagnostics() {
		const fileOrder = new Map<string, number>()
		for (const diagnostic of this.diagnostics) {
			if (!fileOrder.has(diagnostic.file ?? '')) fileOrder.set(diagnostic.file ?? '', fileOrder.size)
		}
		this.diagnostics.sort((left, right) =>
			(fileOrder.get(left.file ?? '')! - fileOrder.get(right.file ?? '')!) ||
			((left.line ?? Infinity) - (right.line ?? Infinity)) ||
			((left.column ?? 0) - (right.column ?? 0)))
	}

	/** Position of the instruction being worked on, for the encoding helpers. */
	instructionPosition(): SourcePosition {
		return atInstruction(this.currentInstruction)
	}

	/** Lexes every file, splicing in each `.include`, into one token stream. */
	tokenizeFiles(): TokenData[] {
		const tokens: TokenData[] = []
		const included = new Set<string>()

		for (const file of this.entries) {
			if (included.has(file.name)) continue
			included.add(file.name)
			tokens.push(...this.tokenizeFile(file, included))
		}

		const last = tokens[tokens.length - 1]
		tokens.push({ type: 'EOF', value: '', line: last ? last.line : 1, column: 1, file: last?.file ?? this.entryFile })
		return tokens
	}

	tokenizeFile(file: SourceFile, included: Set<string>): TokenData[] {
		const tokens = new Lexer(file.code, file.name).tokenize()
		const output: TokenData[] = []

		for (let index = 0; index < tokens.length; index += 1) {
			const token = tokens[index]
			if (token.type === 'EOF') break
			if (token.type !== 'DIRECTIVE' || token.value.toLowerCase() !== '.include') {
				output.push(token)
				continue
			}

			const target = tokens[index + 1]
			if (!target || target.type !== 'STRING') {
				throw new AssemblyError('.include expects a file name', at(token))
			}
			index += 1
			output.push(...this.includeFile(target.value, included, token))
		}

		// Statements must not run together across a file boundary.
		output.push({ type: 'NEWLINE', value: '\n', line: 1, column: 1, file: file.name })
		return output
	}

	includeFile(name: string, included: Set<string>, token: TokenData): TokenData[] {
		const wanted = name.toLowerCase().replace(/^.*[\\/]/, '')
		const file = this.files.find((candidate) => candidate.name === name) ??
			this.files.find((candidate) => candidate.name.toLowerCase().replace(/^.*[\\/]/, '') === wanted)
		if (!file) {
			const available = this.files.map((candidate) => candidate.name).join(', ')
			throw new AssemblyError(`Cannot include "${name}"; open files are: ${available}`, at(token))
		}

		// A file already assembled, or already included, is not repeated.
		if (included.has(file.name)) return []
		included.add(file.name)
		return this.tokenizeFile(file, included)
	}

	generateMachineCode() {
		for (const instr of this.program!.instructions) {
			try {
				this.machineCode.push(this.encodeInstruction(instr))
			} catch (error) {
				this.record(error)
				// One word per instruction either way, so the two stay in step.
				this.machineCode.push(0)
			}
		}
	}

	/**
	 * Turn source-level conveniences into the instructions a MIPS processor
	 * actually executes, and lay them out.  Expansion comes first: a branch
	 * following (for example) `blt` must see the two words emitted for it.  This
	 * is the only pass that assigns a text address, so its source index is the
	 * one every consumer reads.
	 */
	expandPseudoInstructions(parsed: ParseResult): MipsProgram {
		const expanded: MipsInstruction[] = []
		// The parser leaves only data labels resolved; text labels ride on the
		// instructions they precede, so expansion keeps them in step.
		const labels = new Map(parsed.labels)

		for (const instruction of parsed.instructions) {
			try {
				const sequence = this.expandInstruction(instruction)
				sequence.forEach((item, index) => {
					item.labels = index === 0 ? [...instruction.labels] : []
					item.segment = instruction.segment ?? 'text'
					item.sourceFile = instruction.sourceFile ?? ''
					item.sourceColumn = instruction.sourceColumn
					expanded.push(item)
				})
			} catch (error) {
				// The instruction emits nothing; the ones after it still assemble.
				this.record(error)
			}
		}

		const nextAddress: Record<TextSegment, number> = { ...parsed.segmentStarts }
		for (const instruction of expanded) {
			const segment = instruction.segment ?? 'text'
			const address = nextAddress[segment]
			instruction.address = address
			for (const label of instruction.labels) labels.set(label, address)
			nextAddress[segment] = address + 4
		}

		// A label after the final instruction of a text segment names the end of
		// that segment, which only the finished layout knows.
		for (const { segment, labels: endLabels } of parsed.segmentEndLabels) {
			for (const label of endLabels) labels.set(label, nextAddress[segment])
		}

		const program: MipsProgram = {
			instructions: expanded,
			labels,
			data: parsed.data,
			sourceIndex: buildSourceIndex(this.entryFile, expanded, parsed.data),
		}
		this.program = program

		// `la` uses LUI/ORI, so materialize the two halves only after the final
		// label layout is known.  Keeping branches as labels lets their normal
		// PC-relative resolver calculate offsets from each expanded instruction.
		for (const instruction of expanded) {
			this.currentInstruction = instruction
			try {
				if (instruction.name === 'LUI' && instruction.args[1]?.type === 'label') {
					instruction.args[1] = { type: 'immediate', value: this.labelAddress(labels, instruction.args[1]) >>> 16 }
				}
				if (instruction.name === 'ORI' && instruction.args[2]?.type === 'label') {
					instruction.args[2] = { type: 'immediate', value: this.labelAddress(labels, instruction.args[2]) & 0xffff }
				}
			} catch (error) {
				this.record(error)
			}
		}

		return program
	}

	/** Address of a label reference, including the constant of `label+4`. */
	labelAddress(labels: Map<string, number>, arg: LabelArgument): number {
		const address = labels.get(arg.value)
		if (address === undefined) throw new AssemblyError(`Undefined label: ${arg.value}`, this.instructionPosition())
		return address + (arg.offset ?? 0)
	}

	expandInstruction(instruction: MipsInstruction): MipsInstruction[] {
		const make = (name: string, args: MipsArgument[]): MipsInstruction => ({
			name,
			args,
			labels: [],
			address: null,
			sourceLine: instruction.sourceLine,
			sourceColumn: instruction.sourceColumn,
		})
		const reg = (value: string): MipsArgument => ({ type: 'register', value })
		const immediate = (value: number): MipsArgument => ({ type: 'immediate', value })
		const memory = (offset: number, register: string): MipsArgument =>
			({ type: 'memory', offset: { type: 'immediate', value: offset }, register })
		// THRAX accepts a two-operand form of the three-operand arithmetic and
		// logical instructions, where the destination is also the first source.
		const [first, second, third] = TWO_OPERAND_FORMS.has(instruction.name) && instruction.args.length === 2
			? [instruction.args[0], instruction.args[0], instruction.args[1]]
			: instruction.args
		/** Materializes a full 32-bit word in `$at`, for the `li.s`/`li.d` bit patterns. */
		const loadAt = (bits: number): MipsInstruction[] => [
			make('LUI', [reg('$at'), immediate(bits >>> 16)]),
			make('ORI', [reg('$at'), reg('$at'), immediate(bits & 0xffff)]),
		]
		const isImmediate = (arg: MipsArgument | undefined): arg is ImmediateArgument =>
			typeof arg === 'object' && arg?.type === 'immediate'
		const fitsSigned16 = (value: number) => value >= -0x8000 && value <= 0x7fff
		const fitsUnsigned16 = (value: number) => value >= 0 && value <= 0xffff
		/**
		 * Puts `value` in `$at`, in one instruction when it fits the immediate
		 * field, as the THRAX pseudo-op table does.
		 */
		const valueInAt = (value: number): MipsInstruction[] =>
			fitsSigned16(value)
				? [make('ADDI', [reg('$at'), reg('$zero'), immediate(value)])]
				: loadAt(value >>> 0)
		/**
		 * `op rd, rs, imm`.  THRAX folds the immediate into the I-type form when
		 * one exists and the value fits its field, and otherwise routes the value
		 * through `$at` and uses the register form.
		 */
		const withImmediate = (
			registerOp: string,
			immediateOp: string | null,
			unsigned: boolean,
			destination: MipsArgument,
			source: MipsArgument,
			operand: MipsArgument,
		): MipsInstruction[] => {
			if (!isImmediate(operand)) return [make(registerOp, [destination, source, operand])]
			const fits = unsigned ? fitsUnsigned16(operand.value) : fitsSigned16(operand.value)
			if (immediateOp && fits) return [make(immediateOp, [destination, source, operand])]
			return [...valueInAt(operand.value), make(registerOp, [destination, source, reg('$at')])]
		}
		/**
		 * Presents `arg` as a register, materializing a constant into `$at` first.
		 * The set and branch pseudo-ops are written against registers, so this is
		 * how THRAX lets a constant stand in one of their operand positions.
		 */
		const materialize = (arg: MipsArgument): { setup: MipsInstruction[]; operand: MipsArgument } =>
			isImmediate(arg) ? { setup: valueInAt(arg.value), operand: reg('$at') } : { setup: [], operand: arg }
		/** `div`/`rem` in their three-operand form: divide, then take a result. */
		const divideInto = (divide: string, take: string): MipsInstruction[] => {
			if (!isImmediate(third)) return [make(divide, [second, third]), make(take, [first])]
			return [...valueInAt(third.value), make(divide, [second, reg('$at')]), make(take, [first])]
		}
		/** Rotate by assembling the two halves of the shift and merging them. */
		const rotate = (towardsHigh: string, towardsLow: string): MipsInstruction[] => {
			if (isImmediate(third)) {
				const places = third.value & 31
				return [
					make(towardsLow, [reg('$at'), second, immediate((32 - places) & 31)]),
					make(towardsHigh, [first, second, immediate(places)]),
					make('OR', [first, first, reg('$at')]),
				]
			}
			return [
				make('SUBU', [reg('$at'), reg('$zero'), third]),
				make(`${towardsLow}V`, [reg('$at'), second, reg('$at')]),
				make(`${towardsHigh}V`, [first, second, third]),
				make('OR', [first, first, reg('$at')]),
			]
		}
		/** The register one past `arg`, which the doubleword forms pair with. */
		const nextRegister = (arg: MipsArgument): MipsArgument => {
			if (typeof arg !== 'object' || arg.type !== 'register') throw new AssemblyError('Expected a register', atInstruction(instruction))
			const number = registerNumber(arg.value)
			if (number === null) return { type: 'register', value: `$f${fpRegisterNumber(arg.value) + 1}` }
			return reg(REGISTER_NAMES[(number + 1) % 32])
		}
		/** `ld`/`sd` move a register pair to or from two consecutive words. */
		const doubleword = (transfer: string): MipsInstruction[] => {
			const pair = (offset: number, base: string): MipsInstruction[] => [
				make(transfer, [first, { type: 'memory', offset: { type: 'immediate', value: offset }, register: base }]),
				make(transfer, [nextRegister(first), { type: 'memory', offset: { type: 'immediate', value: offset + 4 }, register: base }]),
			]
			if (typeof second === 'object' && second.type === 'memory') {
				const offset = second.offset.type === 'immediate' ? second.offset.value : 0
				return pair(offset, second.register)
			}
			// A label or absolute address does not fit an offset field, so the
			// address goes through $at and both words are read relative to it.
			if (typeof second === 'object' && second.type === 'label') {
				return [make('LUI', [reg('$at'), second]), make('ORI', [reg('$at'), reg('$at'), second]), ...pair(0, '$at')]
			}
			if (isImmediate(second)) return [...loadAt(second.value >>> 0), ...pair(0, '$at')]
			throw new AssemblyError(`${instruction.name} needs an address operand`, atInstruction(instruction))
		}
		/**
		 * A load/store target as an offset(base) operand, `delta` bytes on.  The
		 * unaligned transfers touch one address several times and clobber `$at`
		 * in between, so the setup is re-emitted per access rather than kept.
		 */
		const addressParts = (target: MipsArgument, delta: number): { setup: MipsInstruction[]; operand: MipsArgument } => {
			const throughRegister = (setup: MipsInstruction[], base?: string) => ({
				setup: [...setup, ...(base ? [make('ADDU', [reg('$at'), reg('$at'), reg(base)])] : [])],
				operand: memory(0, '$at'),
			})
			const address = (arg: ImmediateArgument | LabelArgument, base?: string) => {
				if (arg.type === 'immediate') return throughRegister(loadAt((arg.value + delta) >>> 0), base)
				const shifted: LabelArgument = { ...arg, offset: (arg.offset ?? 0) + delta }
				return throughRegister([make('LUI', [reg('$at'), shifted]), make('ORI', [reg('$at'), reg('$at'), shifted])], base)
			}
			if (typeof target === 'object' && target.type === 'memory') {
				if (target.offset.type !== 'immediate') return address(target.offset, target.register)
				return { setup: [], operand: memory(target.offset.value + delta, target.register) }
			}
			if (typeof target === 'object' && (target.type === 'immediate' || target.type === 'label')) return address(target)
			throw new AssemblyError(`${instruction.name} needs an address operand`, atInstruction(instruction))
		}
		/** `ulw`/`usw`: the halves of a word that straddles an alignment boundary. */
		const unalignedWord = (high: string, low: string): MipsInstruction[] => {
			const end = addressParts(second, 3)
			const start = addressParts(second, 0)
			return [...end.setup, make(high, [first, end.operand]), ...start.setup, make(low, [first, start.operand])]
		}
		/** `ulh`/`ulhu`: two bytes, the upper one carrying the sign when signed. */
		const unalignedHalf = (loadHigh: string): MipsInstruction[] => {
			const high = addressParts(second, 1)
			const low = addressParts(second, 0)
			return [
				...high.setup, make(loadHigh, [first, high.operand]),
				...low.setup, make('LBU', [reg('$at'), low.operand]),
				make('SLL', [first, first, immediate(8)]),
				make('OR', [first, first, reg('$at')]),
			]
		}
		/**
		 * `ush`: store two bytes.  Between them the source is rotated right by
		 * eight and back again, which brings the second byte into position
		 * without a scratch register beyond `$at`.
		 */
		const unalignedStoreHalf = (): MipsInstruction[] => {
			const low = addressParts(second, 0)
			const high = addressParts(second, 1)
			const rotate = (out: string, back: string): MipsInstruction[] => [
				make(out, [reg('$at'), first, immediate(24)]),
				make(back, [first, first, immediate(8)]),
				make('OR', [first, first, reg('$at')]),
			]
			return [
				...low.setup, make('SB', [first, low.operand]),
				...rotate('SLL', 'SRL'),
				...high.setup, make('SB', [first, high.operand]),
				...rotate('SRL', 'SLL'),
			]
		}
		/**
		 * `mulo`/`mulou`: multiply, then `break` when the product does not fit
		 * 32 bits.  The branch skips the delay slot too when it exists.
		 */
		const multiplyChecked = (multiply: string, overflowed: MipsInstruction[]): MipsInstruction[] => {
			const { setup, operand } = materialize(third)
			const delaySlot = this.delayedBranching ? [make('NOP', [])] : []
			return [
				...setup,
				make(multiply, [second, operand]),
				make('MFHI', [reg('$at')]),
				...overflowed,
				make('BEQ', [reg('$at'), overflowed.length > 0 ? first : reg('$zero'), immediate(delaySlot.length + 1)]),
				...delaySlot,
				make('BREAK', []),
				make('MFLO', [first]),
			]
		}
		/**
		 * `lw $t0, label` and `l.s $f0, label` name an address that does not fit
		 * an instruction's 16-bit offset field, so the address goes through `$at`.
		 */
		const throughAt = (name: string, register: MipsArgument, target: MipsArgument): MipsInstruction[] => {
			if (typeof target !== 'object' || target.type !== 'label') return [make(name, [register, target])]
			return [
				make('LUI', [reg('$at'), target]),
				make('ORI', [reg('$at'), reg('$at'), target]),
				make(name, [register, { type: 'memory', offset: { type: 'immediate', value: 0 }, register: '$at' }]),
			]
		}

		switch (instruction.name) {
			case 'NOP': return [make('SLL', [reg('$zero'), reg('$zero'), immediate(0)])]
			case 'MOVE': return [make('ADDU', [first, second, reg('$zero')])]
			case 'LI': {
				if (second?.type !== 'immediate') throw new AssemblyError('li requires an immediate value', atInstruction(instruction))
				if (second.value >= -0x8000 && second.value <= 0x7fff) return [make('ADDIU', [first, reg('$zero'), second])]
				return [
					make('LUI', [first, immediate(second.value >>> 16)]),
					make('ORI', [first, first, immediate(second.value & 0xffff)]),
				]
			}
			case 'LA': return [make('LUI', [first, second]), make('ORI', [first, first, second])]
			case 'B': return [make('BEQ', [reg('$zero'), reg('$zero'), first])]
			case 'BAL': return [make('JAL', [first])]
			case 'BEQZ': return [make('BEQ', [first, reg('$zero'), second])]
			case 'BNEZ': return [make('BNE', [first, reg('$zero'), second])]
			case 'BLT':
			case 'BGE':
			case 'BLTU':
			case 'BGEU': {
				const { setup, operand } = materialize(second)
				const compare = instruction.name.endsWith('U') ? 'SLTU' : 'SLT'
				const branch = instruction.name.startsWith('BLT') ? 'BNE' : 'BEQ'
				return [...setup, make(compare, [reg('$at'), first, operand]), make(branch, [reg('$at'), reg('$zero'), third])]
			}
			case 'BLE':
			case 'BGT':
			case 'BLEU':
			case 'BGTU': {
				const { setup, operand } = materialize(second)
				const compare = instruction.name.endsWith('U') ? 'SLTU' : 'SLT'
				const branch = instruction.name.startsWith('BGT') ? 'BNE' : 'BEQ'
				return [...setup, make(compare, [reg('$at'), operand, first]), make(branch, [reg('$at'), reg('$zero'), third])]
			}
			case 'NOT': return [make('NOR', [first, second, reg('$zero')])]
			case 'NEG': return [make('SUB', [first, reg('$zero'), second])]
			case 'NEGU': return [make('SUBU', [first, reg('$zero'), second])]
			case 'ABS': return [
				make('SRA', [reg('$at'), second, immediate(31)]),
				make('XOR', [first, second, reg('$at')]),
				make('SUBU', [first, first, reg('$at')]),
			]
			case 'SEQ':
			case 'SNE': {
				const { setup, operand } = materialize(third)
				const finish = instruction.name === 'SEQ'
					? make('SLTIU', [first, first, immediate(1)])
					: make('SLTU', [first, reg('$zero'), first])
				return [...setup, make('XOR', [first, second, operand]), finish]
			}
			case 'SGT':
			case 'SGTU': {
				const { setup, operand } = materialize(third)
				return [...setup, make(instruction.name === 'SGTU' ? 'SLTU' : 'SLT', [first, operand, second])]
			}
			case 'SGE':
			case 'SGEU':
			case 'SLE':
			case 'SLEU': {
				const { setup, operand } = materialize(third)
				const compare = instruction.name.endsWith('U') ? 'SLTU' : 'SLT'
				// `x >= y` is `!(x < y)`; `x <= y` is `!(y < x)`.
				const args = instruction.name.startsWith('SGE') ? [first, second, operand] : [first, operand, second]
				return [...setup, make(compare, args), make('XORI', [first, first, immediate(1)])]
			}
			case 'L.S': return throughAt('LWC1', first, second)
			case 'L.D': return throughAt('LDC1', first, second)
			case 'S.S': return throughAt('SWC1', first, second)
			case 'S.D': return throughAt('SDC1', first, second)
			case 'LWC1':
			case 'LDC1':
			case 'SWC1':
			case 'SDC1':
			case 'LW':
			case 'LH':
			case 'LHU':
			case 'LB':
			case 'LBU':
			case 'SW':
			case 'SH':
			case 'SB':
			case 'LL':
			case 'SC':
			case 'LWL':
			case 'LWR':
			case 'SWL':
			case 'SWR':
				return throughAt(instruction.name, first, second)
			case 'ULW': return unalignedWord('LWL', 'LWR')
			case 'USW': return unalignedWord('SWL', 'SWR')
			case 'ULH': return unalignedHalf('LB')
			case 'ULHU': return unalignedHalf('LBU')
			case 'USH': return unalignedStoreHalf()
			// The signed form compares the high word against the sign of the low
			// one; the unsigned form only needs the high word to be zero.
			case 'MULO': return multiplyChecked('MULT', [make('MFLO', [first]), make('SRA', [first, first, immediate(31)])])
			case 'MULOU': return multiplyChecked('MULTU', [])
			case 'LI.S': {
				if (second?.type !== 'immediate') throw new AssemblyError('li.s requires an immediate value', atInstruction(instruction))
				return [...loadAt(singleToBits(second.value)), make('MTC1', [reg('$at'), first])]
			}
			case 'LI.D': {
				if (second?.type !== 'immediate') throw new AssemblyError('li.d requires an immediate value', atInstruction(instruction))
				if (first?.type !== 'register') throw new AssemblyError('li.d requires a floating-point register', atInstruction(instruction))
				const index = fpRegisterNumber(first.value)
				if (index % 2 !== 0) throw new AssemblyError(`li.d requires an even register, not ${first.value}`, atInstruction(instruction))
				const { low, high } = doubleToBits(second.value)
				return [
					...loadAt(low), make('MTC1', [reg('$at'), first]),
					...loadAt(high), make('MTC1', [reg('$at'), reg(`$f${index + 1}`)]),
				]
			}
			// Three-operand div/rem are pseudo-ops; the two-operand forms are real.
			case 'REM': return divideInto('DIV', 'MFHI')
			case 'REMU': return divideInto('DIVU', 'MFHI')
			case 'DIV': return instruction.args.length < 3 ? [instruction] : divideInto('DIV', 'MFLO')
			case 'DIVU': return instruction.args.length < 3 ? [instruction] : divideInto('DIVU', 'MFLO')
			case 'MULU': return [
				...(isImmediate(third) ? valueInAt(third.value) : []),
				make('MULTU', [second, isImmediate(third) ? reg('$at') : third]),
				make('MFLO', [first]),
			]

			// An immediate where a register belongs.  THRAX accepts these and
			// widens them; dropping the operand would assemble a wrong answer.
			case 'ADD': return withImmediate('ADD', 'ADDI', false, first, second, third)
			case 'ADDU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
			case 'ADDI': return withImmediate('ADD', 'ADDI', false, first, second, third)
			case 'ADDIU': return withImmediate('ADDU', 'ADDIU', false, first, second, third)
			case 'SUB':
			case 'SUBI': return withImmediate('SUB', null, false, first, second, third)
			case 'SUBU':
			case 'SUBIU': return withImmediate('SUBU', null, false, first, second, third)
			case 'AND': return withImmediate('AND', 'ANDI', true, first, second, third)
			case 'OR': return withImmediate('OR', 'ORI', true, first, second, third)
			case 'XOR': return withImmediate('XOR', 'XORI', true, first, second, third)
			case 'ANDI': return withImmediate('AND', 'ANDI', true, first, second, third)
			case 'ORI': return withImmediate('OR', 'ORI', true, first, second, third)
			case 'XORI': return withImmediate('XOR', 'XORI', true, first, second, third)
			case 'SLT': return withImmediate('SLT', 'SLTI', false, first, second, third)
			case 'SLTU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
			case 'SLTI': return withImmediate('SLT', 'SLTI', false, first, second, third)
			case 'SLTIU': return withImmediate('SLTU', 'SLTIU', false, first, second, third)
			case 'MUL': return withImmediate('MUL', null, false, first, second, third)

			// A branch may compare against a constant, which goes through $at.
			case 'BEQ':
			case 'BNE': {
				if (!isImmediate(second)) return [instruction]
				return [...valueInAt(second.value), make(instruction.name, [first, reg('$at'), third])]
			}

			case 'ROL': return rotate('SLL', 'SRL')
			case 'ROR': return rotate('SRL', 'SLL')

			case 'LD': return doubleword('LW')
			case 'SD': return doubleword('SW')
			case 'MFC1.D': return [make('MFC1', [first, second]), make('MFC1', [nextRegister(first), nextRegister(second)])]
			case 'MTC1.D': return [make('MTC1', [first, second]), make('MTC1', [nextRegister(first), nextRegister(second)])]
			default: return [{ ...instruction, args: [...instruction.args], labels: [] }]
		}
	}

	encodeInstruction(instr: MipsInstruction): number {
		const name = instr.name
		this.currentAddress = instr.address
		this.currentInstruction = instr

		// Resolve labels in arguments
		const args = instr.args.map((arg) => this.resolveArgument(arg))
		// The simulator executes the parsed instruction objects, so preserve the
		// resolved addresses there as well as in the encoded instruction.
		instr.args = args

		// R-type instructions (func-based)
		const rTypeInstructions: Record<string, { opcode: number; func: number }> = {
			ADD: { opcode: 0, func: 0x20 },
			ADDU: { opcode: 0, func: 0x21 },
			SUB: { opcode: 0, func: 0x22 },
			SUBU: { opcode: 0, func: 0x23 },
			AND: { opcode: 0, func: 0x24 },
			OR: { opcode: 0, func: 0x25 },
			XOR: { opcode: 0, func: 0x26 },
			NOR: { opcode: 0, func: 0x27 },
			SLT: { opcode: 0, func: 0x2a },
			SLTU: { opcode: 0, func: 0x2b },
		MULT: { opcode: 0, func: 0x18 },
		MULTU: { opcode: 0, func: 0x19 },
		MUL: { opcode: 0x1c, func: 0x02 },
			DIV: { opcode: 0, func: 0x1a },
			DIVU: { opcode: 0, func: 0x1b },
			MFHI: { opcode: 0, func: 0x10 },
			MFLO: { opcode: 0, func: 0x12 },
			MTHI: { opcode: 0, func: 0x11 },
			MTLO: { opcode: 0, func: 0x13 },
			SLL: { opcode: 0, func: 0x00 },
			SRL: { opcode: 0, func: 0x02 },
			SRA: { opcode: 0, func: 0x03 },
			SLLV: { opcode: 0, func: 0x04 },
			SRLV: { opcode: 0, func: 0x06 },
			SRAV: { opcode: 0, func: 0x07 },
			JR: { opcode: 0, func: 0x08 },
			JALR: { opcode: 0, func: 0x09 },
		}

		// I-type instructions
		const iTypeInstructions: Record<string, number> = {
			ADDI: 0x08,
			ADDIU: 0x09,
			SLTI: 0x0a,
			SLTIU: 0x0b,
			ANDI: 0x0c,
			ORI: 0x0d,
			XORI: 0x0e,
			LUI: 0x0f,
			BEQ: 0x04,
			BNE: 0x05,
			BGEZ: 0x01,
			BGTZ: 0x07,
			BLEZ: 0x06,
			BLTZ: 0x01,
			LW: 0x23,
			LH: 0x21,
			LHU: 0x25,
			LB: 0x20,
			LBU: 0x24,
			SW: 0x2b,
			SH: 0x29,
			SB: 0x28,
			LWL: 0x22,
			LWR: 0x26,
			SWL: 0x2a,
			SWR: 0x2e,
			LL: 0x30,
			SC: 0x38,
		}

		// J-type instructions
		const jTypeInstructions: Record<string, number> = {
			J: 0x02,
			JAL: 0x03,
		}

		const coprocessorCode = this.encodeCoprocessor(name, args)
		if (coprocessorCode !== null) return coprocessorCode

		if (rTypeInstructions[name]) {
			return this.encodeRType(name, args, rTypeInstructions[name])
		}
		if (iTypeInstructions[name]) {
			return this.encodeIType(name, args, iTypeInstructions[name])
		}
		if (jTypeInstructions[name]) {
			return this.encodeJType(name, args, jTypeInstructions[name])
		}

		// Pseudo-instructions should have been expanded before encoding.
		switch (name) {
			case 'NOP':
				return 0x00000000
			case 'MOVE':
				// move $rd, $rs -> addu $rd, $rs, $zero
				return this.encodeRType('ADDU', args, { opcode: 0, func: 0x21 })
		case 'SYSCALL':
			return 0x0000000c
			case 'BREAK':
				return (((this.getImmediateValue(args[0]) & 0xfffff) << 6) | 0x0d) >>> 0
			default:
				throw new AssemblyError(`Unknown instruction: ${name}`, this.instructionPosition())
		}
	}

	/** Encodes a CP0 or CP1 instruction, or returns null when `name` is neither. */
	encodeCoprocessor(name: string, args: MipsArgument[]): number | null {
		if (name === 'ERET') return ((COP0_OPCODE << 26) | (1 << 25) | 0x18) >>> 0

		if (name === 'MFC0' || name === 'MTC0') {
			const rt = this.getRegisterNumber(args[0])
			const rd = this.getCp0RegisterNumber(args[1])
			return ((COP0_OPCODE << 26) | ((name === 'MTC0' ? 4 : 0) << 21) | (rt << 16) | (rd << 11)) >>> 0
		}

		if (FP_MEMORY_OPCODES[name] !== undefined) {
			const ft = this.getFpRegisterNumber(args[0])
			const target = args[1]
			const isMemory = typeof target === 'object' && target.type === 'memory'
			const base = isMemory ? this.getRegisterNumber(target.register) : 0
			const offset = (isMemory ? this.getImmediateValue(target.offset) : this.getImmediateValue(target)) & 0xffff
			return ((FP_MEMORY_OPCODES[name] << 26) | (base << 21) | (ft << 16) | offset) >>> 0
		}

		if (name === 'MFC1' || name === 'MTC1') {
			const rt = this.getRegisterNumber(args[0])
			const fs = this.getFpRegisterNumber(args[1])
			return ((COP1_OPCODE << 26) | ((name === 'MTC1' ? 4 : 0) << 21) | (rt << 16) | (fs << 11)) >>> 0
		}

		// Condition code 0 is the only flag the assembler's syntax reaches.
		if (name === 'BC1T' || name === 'BC1F') {
			const offset = this.getBranchOffset(args[0]) & 0xffff
			return ((COP1_OPCODE << 26) | (8 << 21) | ((name === 'BC1T' ? 1 : 0) << 16) | offset) >>> 0
		}

		if (name === 'MOVF' || name === 'MOVT') {
			const rd = this.getRegisterNumber(args[0])
			const rs = this.getRegisterNumber(args[1])
			return ((rs << 21) | ((name === 'MOVT' ? 1 : 0) << 16) | (rd << 11) | 0x01) >>> 0
		}

		const parts = name.split('.')
		const format = FP_FORMAT_CODES[parts[parts.length - 1]]
		if (format === undefined) return null

		if (parts.length === 2 && FP_ARITHMETIC_FUNCTIONS[parts[0]] !== undefined) {
			const unary = FP_UNARY_OPERATIONS.has(parts[0])
			return this.encodeCop1(
				format,
				unary ? 0 : this.getFpRegisterNumber(args[2]),
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_ARITHMETIC_FUNCTIONS[parts[0]],
			)
		}

		if (parts.length === 3 && parts[0] === 'C' && FP_COMPARE_FUNCTIONS[parts[1]] !== undefined) {
			return this.encodeCop1(
				format,
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				0,
				FP_COMPARE_FUNCTIONS[parts[1]],
			)
		}

		if (parts.length === 3 && FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`] !== undefined) {
			return this.encodeCop1(
				format,
				0,
				this.getFpRegisterNumber(args[1]),
				this.getFpRegisterNumber(args[0]),
				FP_CONVERT_FUNCTIONS[`${parts[0]}.${parts[1]}`],
			)
		}

		return null
	}

	encodeCop1(format: number, ft: number, fs: number, fd: number, func: number): number {
		return ((COP1_OPCODE << 26) | (format << 21) | (ft << 16) | (fs << 11) | (fd << 6) | func) >>> 0
	}

	getFpRegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return fpRegisterNumber(arg.value)
		throw new AssemblyError('Expected a floating-point register', this.instructionPosition())
	}

	getCp0RegisterNumber(arg: MipsArgument | undefined): number {
		if (typeof arg === 'object' && arg.type === 'register') return cp0RegisterNumber(arg.value)
		throw new AssemblyError('Expected a coprocessor 0 register', this.instructionPosition())
	}

	encodeRType(name: string, args: MipsArgument[], { opcode, func }: { opcode: number; func: number }): number {
		let rs = 0,
			rt = 0,
			rd = 0,
			shamt = 0

		// Determine argument positions based on instruction
		if (['SLL', 'SRL', 'SRA'].includes(name)) {
			// rd, rt, shamt format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			shamt = this.getImmediateValue(args[2])
		} else if (['SLLV', 'SRLV', 'SRAV'].includes(name)) {
			// rd, rt, rs format
			rd = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			rs = this.getRegisterNumber(args[2])
		} else if (['MFHI', 'MFLO'].includes(name)) {
			// rd only
			rd = this.getRegisterNumber(args[0])
		} else if (['MTHI', 'MTLO', 'JR'].includes(name)) {
			// rs only
			rs = this.getRegisterNumber(args[0])
		} else if (['MULT', 'MULTU', 'DIV', 'DIVU'].includes(name)) {
			// rs, rt format
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
		} else if (['JALR'].includes(name)) {
			// rd, rs format, or rs alone with $ra as the implied link register
			if (args.length === 2) {
				rd = this.getRegisterNumber(args[0])
				rs = this.getRegisterNumber(args[1])
			} else {
				rd = 31
				rs = this.getRegisterNumber(args[0])
			}
		} else {
			// Standard rd, rs, rt format (or variants)
			rd = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			rt = this.getRegisterNumber(args[2])
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | func) >>> 0
	}

	encodeIType(name: string, args: MipsArgument[], opcode: number): number {
		let rs = 0,
			rt = 0,
			imm = 0

		// Load/Store instructions: rt, offset(rs)
		if (LOAD_STORE_NAMES.has(name)) {
			rt = this.getRegisterNumber(args[0])
			if (args[1].type === 'memory') {
				rs = this.getRegisterNumber(args[1].register)
				imm = this.getImmediateValue(args[1].offset) & 0xffff
			} else {
				imm = this.getImmediateValue(args[1]) & 0xffff
			}
		}
		// Branch instructions: rs, rt, offset
		else if (['BEQ', 'BNE'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = this.getRegisterNumber(args[1])
			imm = this.getBranchOffset(args[2]) & 0xffff
		}
		// Branch against zero: rs, offset.  bltz and bgez share opcode 1 and are
		// told apart by rt.
		else if (['BGEZ', 'BGTZ', 'BLEZ', 'BLTZ'].includes(name)) {
			rs = this.getRegisterNumber(args[0])
			rt = name === 'BGEZ' ? 1 : 0
			imm = this.getBranchOffset(args[1]) & 0xffff
		}
		// LUI: rt, imm
		else if (name === 'LUI') {
			rt = this.getRegisterNumber(args[0])
			imm = this.getImmediateValue(args[1]) & 0xffff
		}
		// Standard: rt, rs, imm
		else {
			rt = this.getRegisterNumber(args[0])
			rs = this.getRegisterNumber(args[1])
			imm = this.getImmediateValue(args[2]) & 0xffff
		}

		return ((opcode << 26) | (rs << 21) | (rt << 16) | imm) >>> 0
	}

	encodeJType(name: string, args: MipsArgument[], opcode: number): number {
		const address = this.getJumpAddress(args[0]) >> 2
		return ((opcode << 26) | (address & 0x3ffffff)) >>> 0
	}

	getRegisterNumber(arg: MipsArgument | string | undefined): number {
		const name = typeof arg === 'string'
			? arg
			: typeof arg === 'object' && arg.type === 'register' ? arg.value : null
		// Falling back to register 0 here silently drops the operand, which turns
		// `add $t0, $t1, 5` into `add $t0, $t1, $zero` and assembles a wrong answer.
		if (name === null) throw new AssemblyError(`Expected a register, found ${describeArgument(arg)}`, this.instructionPosition())

		const number = registerNumber(name)
		if (number === null) throw new AssemblyError(`Unknown register: ${name}`, this.instructionPosition())
		return number
	}

	getImmediateValue(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) return arg.address
		if (typeof arg === 'object' && 'value' in arg && typeof arg.value === 'number') return arg.value
		return 0
	}

	getBranchOffset(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		// A number in a branch's target position is an offset in words.
		if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			// Offset is relative to PC+4, in words (divide by 4)
			return (arg.address - (this.currentAddress + 4)) >> 2
		}
		return 0
	}

	getJumpAddress(arg: MipsArgument | number | undefined): number {
		if (typeof arg === 'number') return arg
		if (typeof arg === 'object' && 'address' in arg && arg.address !== undefined) {
			return arg.address
		}
		return 0
	}

	resolveArgument(arg: MipsArgument): MipsArgument {
		if (arg.type === 'label') {
			return { ...arg, address: this.labelAddress(this.program!.labels, arg) }
		}
		if (arg.type === 'memory') {
			const offset = this.resolveArgument(arg.offset)
			if (offset.type !== 'immediate' && offset.type !== 'label') throw new AssemblyError('Invalid memory offset', this.instructionPosition())
			return { ...arg, offset }
		}
		return arg
	}
}

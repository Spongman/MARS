import { create } from 'zustand'
import { Assembler, type SourceFile } from '../core/assembler'
import { CP0_REGISTER_COUNT, CP0_STATUS_INITIAL, FP_CONDITION_FLAG_COUNT, FP_REGISTER_COUNT } from '../core/coprocessor'
import { MipsSimulator } from '../core/simulator'
import type { CallFrame, CodeWord, CoprocessorState, KeyboardDisplayState, MemoryView, PendingInput, Registers } from '../core/types'
import { isFlagSet, readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import { downloadHexText } from '../services/hexTextExport'
import { BranchHistoryTable, DEFAULT_BHT_SETTINGS, type BranchHistorySettings, type BranchHistorySnapshot } from '../tools/branchHistory'
import { CacheSimulator, DEFAULT_CACHE_SETTINGS, type CacheSettings, type CacheSnapshot } from '../tools/cache'
import { DEFAULT_PIPELINE_SETTINGS, PipelineModel, type PipelineSettings, type PipelineSnapshot } from '../tools/pipeline'
import { ExecutionProfile, type ProfileSnapshot } from '../tools/profile'
import { InstructionStatistics, type StatisticsSnapshot } from '../tools/statistics'

/**
 * Instructions per second the run-speed control offers.  null runs flat out;
 * the slow end is where an animated run is worth watching.
 */
export const RUN_SPEEDS: Array<number | null> = [1, 2, 5, 10, 30, 100, 300, 1000, 5000, 30000, null]

const SAVED_PROGRAM_KEY = 'thrax-web.saved-program'
const SAVED_PROGRAM_VERSION = 2
const INITIAL_CODE = '# Simple addition example\n# $t0 = 5, $t1 = 3, $t2 = $t0 + $t1\naddi $t0, $zero, 5\naddi $t1, $zero, 3\nadd $t2, $t0, $t1\n\n# Print result (syscall 1)\nmove $a0, $t2\naddi $v0, $zero, 1\nsyscall\n\n# Exit (syscall 10)\naddi $v0, $zero, 10\nsyscall\n'
interface SavedProgram {
	version: number
	code: string
	savedAt: string
	documents?: SourceDocument[]
	activeDocumentId?: string
	assembleAllFiles?: boolean
}

/** Machine-word columns the source editor draws between the gutter and the code. */
export interface GutterColumns {
	address: boolean
	code: boolean
	disassembly: boolean
}

/** Code shows the instruction word; data shows its bytes in address order. */
export const DEFAULT_GUTTER_COLUMNS: GutterColumns = { address: false, code: false, disassembly: false }

const GUTTER_SETTING = 'source.gutter'
const HEAT_MAP_SETTING = 'source.heatmap'
const RUN_SPEED_SETTING = 'run.speed'
const ASSEMBLE_ALL_SETTING = 'assemble.allFiles'
const DELAYED_BRANCHING_SETTING = 'assemble.delayedBranching'
const CACHE_SETTING = 'tools.cache'
const BRANCH_HISTORY_SETTING = 'tools.branchHistory'
const PIPELINE_SETTING = 'tools.pipeline'

const isBoolean = (value: unknown) => typeof value === 'boolean'
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isCount = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0

/**
 * Tool settings are validated field by field: a stored setting the tool cannot
 * read would otherwise reach it as a configuration it has no branch for.
 */
const isCacheSettings = (value: unknown) => isRecord(value) &&
	isCount(value.blockCount) && isCount(value.blockSizeBytes) && isCount(value.associativity) &&
	['lru', 'random', 'fifo'].includes(value.replacement as string)

const isBranchHistorySettings = (value: unknown) => isRecord(value) &&
	isCount(value.entryCount) && (value.historyBits === 1 || value.historyBits === 2) && isBoolean(value.initiallyTaken)

const isPipelineSettings = (value: unknown) => isRecord(value) &&
	['forwarding', 'split-decode', 'none'].includes(value.dataHazards as string) &&
	['id', 'ex', 'mem'].includes(value.resolveBranchIn as string) &&
	['id', 'ex'].includes(value.resolveJumpIn as string) &&
	['none', 'taken', 'not-taken', 'one-bit', 'two-bit'].includes(value.prediction as string) &&
	isCount(value.windowSize)
const HEAT_MAP_LINES_SETTING = 'source.heatmap.lines'

export interface SourceDocument {
	id: string
	title: string
	code: string
	dirty: boolean
}

function getSavedProgram(): SavedProgram | null {
	try {
		const rawProgram = window.localStorage.getItem(SAVED_PROGRAM_KEY)
		if (!rawProgram) return null
		const program: unknown = JSON.parse(rawProgram)
		if (
			typeof program !== 'object' ||
			program === null ||
			!('version' in program) ||
			!('code' in program) ||
			((program as SavedProgram).version !== 1 && (program as SavedProgram).version !== SAVED_PROGRAM_VERSION) ||
			typeof (program as SavedProgram).code !== 'string'
		) {
			return null
		}
		return program as SavedProgram
	} catch {
		return null
	}
}

function hasSavedDocuments(program: SavedProgram): program is SavedProgram & { documents: SourceDocument[], activeDocumentId: string } {
	return Array.isArray(program.documents) &&
		program.documents.length > 0 &&
		program.documents.every((document) =>
			typeof document === 'object' &&
			document !== null &&
			typeof document.id === 'string' &&
			typeof document.title === 'string' &&
			typeof document.code === 'string'
		) &&
		typeof program.activeDocumentId === 'string' &&
		program.documents.some((document) => document.id === program.activeDocumentId)
}

const initialRegisters: Registers = {
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

function initialCoprocessorState(): CoprocessorState {
	const cp0Registers = new Array(CP0_REGISTER_COUNT).fill(0)
	cp0Registers[12] = CP0_STATUS_INITIAL
	return {
		fpRegisters: new Array(FP_REGISTER_COUNT).fill(0),
		fpConditionFlags: new Array(FP_CONDITION_FLAG_COUNT).fill(false),
		cp0Registers,
	}
}

interface THRAXStore extends CoprocessorState {
	code: string
	documents: SourceDocument[]
	activeDocumentId: string
	/** Assemble every open tab as one program, rather than the active tab alone. */
	assembleAllFiles: boolean
	/** THRAX's delayed branching setting: the instruction after a branch runs first. */
	delayedBranching: boolean
	registers: Registers
	memory: MemoryView
	console: string
	currentLine: number
	pc: number
	halted: boolean
	instructionCount: number
	sourceMap: Map<number, number>
	/** Machine words of the entry file, keyed by source line, in address order. */
	codeWords: Map<number, CodeWord[]>
	labels: Map<string, number>
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	keyboardDisplay: KeyboardDisplayState
	isRunning: boolean
	isPaused: boolean
	breakpoints: Set<number>
	breakpointLines: Set<number>
	/** Breakpoints on addresses with no source line, such as the tail of a pseudo-instruction. */
	breakpointAddresses: Set<number>
	/** Counts runs, so the console is brought forward only once per run. */
	runToken: number
	/** How the console tab asks to be noticed while it is hidden. */
	consoleAttention: 'none' | 'output' | 'input'
	/** Machine-word columns the source gutter is showing. */
	gutterColumns: GutterColumns
	/** Whether the editor colours line numbers by how often they ran. */
	heatMap: boolean
	/** Whether the heat map tints the source line behind the code as well. */
	heatMapLines: boolean
	/** Whether the source editor is showing its find and replace bar. */
	findReplaceOpen: boolean
	/** Address the memory view is pointing at, highlighted in the source editor. */
	hoveredAddress: number | null
	/** Index into callStack of the selected frame, -1 for the running frame, null for none. */
	selectedFrame: number | null
	executionHistory: ReturnType<MipsSimulator['getExecutionHistory']>
	hasSavedProgram: boolean
	/** Instructions per second while running, or null for no pacing. */
	runSpeed: number | null
	statistics: StatisticsSnapshot
	/** Execution count per instruction address, shown as a heat map in the editor. */
	profile: ProfileSnapshot
	cache: CacheSnapshot
	cacheSettings: CacheSettings
	branchHistory: BranchHistorySnapshot
	branchHistorySettings: BranchHistorySettings
	pipeline: PipelineSnapshot
	pipelineSettings: PipelineSettings
	setCode: (code: string) => void
	/** Edits one open file, which need not be the one being assembled. */
	setDocumentCode: (documentId: string, code: string) => void
	setAssembleAllFiles: (assembleAllFiles: boolean) => void
	setDelayedBranching: (delayedBranching: boolean) => void
	saveProgram: () => boolean
	loadProgram: () => boolean
	exportHexText: () => boolean
	createDocument: () => void
	selectDocument: (documentId: string) => void
	renameDocument: (documentId: string, title: string) => void
	closeDocument: (documentId: string) => void
	assemble: () => void
	submitInput: (input: string, cancelled?: boolean) => Promise<void>
	setRunSpeed: (speed: number | null) => void
	setCacheSettings: (settings: CacheSettings) => void
	setBranchHistorySettings: (settings: BranchHistorySettings) => void
	setPipelineSettings: (settings: PipelineSettings) => void
	sendKeyboardInput: (input: string) => void
	setRegisters: (registers: Registers) => void
	setMemory: (memory: MemoryView) => void
	appendConsole: (text: string) => void
	clearConsole: () => void
	run: () => Promise<void>
	step: () => void
	stepBack: () => void
	stepOver: () => Promise<void>
	stepToReturn: () => Promise<void>
	/** Runs until the given address is reached, without keeping a breakpoint there. */
	runToAddress: (address: number) => Promise<void>
	/** Moves execution to the given address without running anything. */
	setProgramCounter: (address: number) => void
	pause: () => void
	continue: () => Promise<void>
	addBreakpoint: (address: number) => void
	removeBreakpoint: (address: number) => void
	toggleBreakpoint: (address: number) => void
	toggleBreakpointLine: (line: number) => void
	toggleBreakpointAddress: (address: number) => void
	setBreakpointLines: (lines: Iterable<number>) => void
	setHoveredAddress: (address: number | null) => void
	setSelectedFrame: (frame: number | null) => void
	setGutterColumns: (columns: GutterColumns) => void
	setHeatMap: (shown: boolean) => void
	setHeatMapLines: (shown: boolean) => void
	setFindReplaceOpen: (open: boolean) => void
	setConsoleAttention: (attention: 'none' | 'output' | 'input') => void
	/** Assembles without reporting failures, to keep the memory view current while editing. */
	refreshAssembly: () => void
	reset: () => void
}

export const useTHRAXStore = create<THRAXStore>((set, get) => {
	let simulator: MipsSimulator | null = null
	/** File whose source map and machine words decorate the editor. */
	let entryFile = ''

	const normalizeBreakpointLines = (lines: Set<number>, sourceMap: Map<number, number>) => {
		const codeLines = [...sourceMap.keys()].sort((left, right) => left - right)
		return new Set([...lines].flatMap((line) => {
			const target = codeLines.find((codeLine) => codeLine >= line)
			return target === undefined ? [] : [target]
		}))
	}

	/**
	 * Every open tab is visible to `.include`; which of them are assembled into
	 * the program depends on the multi-file setting.  The active tab comes first,
	 * so it owns the entry point and the source map the editor is decorated with.
	 */
	const assemblySources = (): { files: SourceFile[], entries: string[] } => {
		const { activeDocumentId, assembleAllFiles, code, documents } = get()
		const active = documents.find((document) => document.id === activeDocumentId)
		const activeFile: SourceFile = { name: active?.title ?? 'main.asm', code }
		const others = documents
			.filter((document) => document.id !== activeDocumentId)
			.map((document) => ({ name: document.title, code: document.code }))
		const files = [activeFile, ...others].filter((file, index, all) => all.findIndex((other) => other.name === file.name) === index)
		return { files, entries: assembleAllFiles ? files.map((file) => file.name) : [activeFile.name] }
	}

	// Tool settings outlive the session, so the tools start configured as they
	// were left rather than at their defaults.
	const initialCacheSettings = readStoredSetting(CACHE_SETTING, DEFAULT_CACHE_SETTINGS, isCacheSettings)
	const initialBranchHistorySettings = readStoredSetting(BRANCH_HISTORY_SETTING, DEFAULT_BHT_SETTINGS, isBranchHistorySettings)
	const initialPipelineSettings = readStoredSetting(PIPELINE_SETTING, DEFAULT_PIPELINE_SETTINGS, isPipelineSettings)

	const statistics = new InstructionStatistics()
	const profile = new ExecutionProfile()
	const cache = new CacheSimulator(initialCacheSettings)
	const branchHistory = new BranchHistoryTable(initialBranchHistorySettings)
	const pipeline = new PipelineModel(initialPipelineSettings)

	/** The tool readings, recomputed whenever the view is refreshed. */
	const toolView = () => ({
		statistics: statistics.snapshot(),
		profile: profile.snapshot(),
		cache: cache.snapshot(),
		branchHistory: branchHistory.snapshot(),
		pipeline: pipeline.snapshot(),
	})

	const createSimulator = (breakpointLines: Set<number>) => {
		const { files, entries } = assemblySources()
		const { delayedBranching } = get()
		const assembler = new Assembler(files, entries, { delayedBranching })
		const { program, machineCode } = assembler.assemble()
		entryFile = assembler.entryFile
		const nextSimulator = new MipsSimulator(machineCode, program)
		nextSimulator.delayedBranching = delayedBranching
		pipeline.delaySlots = delayedBranching
		nextSimulator.speed = get().runSpeed
		nextSimulator.pacedAddresses = get().gutterColumns.disassembly ? null : visibleAddresses(nextSimulator)
		// A paced run is worth watching, so refresh the workspace between batches.
		nextSimulator.onProgress = () => set({ ...simulatorView(), ...toolView(), isRunning: true, isPaused: false })
		statistics.reset()
		profile.reset()
		cache.reset()
		branchHistory.reset()
		pipeline.reset()
		nextSimulator.observers.push(statistics, profile, cache, branchHistory, pipeline)
		const normalizedBreakpointLines = normalizeBreakpointLines(breakpointLines, program.sourceMap)
		for (const line of normalizedBreakpointLines) {
			const address = program.sourceMap.get(line)
			if (address !== undefined) nextSimulator.addBreakpoint(address)
		}
		// Address breakpoints outlive the re-assembly that follows every edit.
		for (const address of get().breakpointAddresses) nextSimulator.addBreakpoint(address)
		return { simulator: nextSimulator, breakpointLines: normalizedBreakpointLines }
	}

	/** Data rows are four bytes wide, like the instructions above them. */
	const DATA_ROW_BYTES = 4
	/** Long data, such as a string or `.space`, stops after this many rows. */
	const MAX_DATA_ROWS = 4

	/** Groups the assembled bytes of the entry file under the line that wrote them. */
	const entryCodeWords = (current: MipsSimulator) => {
		const codeWords = new Map<number, CodeWord[]>()
		const addRow = (line: number, row: CodeWord) => {
			const rows = codeWords.get(line) ?? []
			rows.push(row)
			codeWords.set(line, rows)
		}

		current.program.instructions.forEach((instruction, index) => {
			if ((instruction.sourceFile ?? '') !== entryFile || instruction.address === null) return
			const word = current.machineCode[index] ?? 0
			const bytes = [0, 1, 2, 3].map((offset) => (word >>> (24 - offset * 8)) & 0xff)
			addRow(instruction.sourceLine, { address: instruction.address, word, bytes })
		})

		// Data holds no instructions, so its rows carry the loaded bytes alone.
		for (const entry of current.program.data) {
			if ((entry.sourceFile ?? '') !== entryFile || entry.sourceLine === undefined) continue
			const size = entry.bytes.reduce<number>((total, item) => total + (typeof item === 'number' ? 1 : item.width), 0)
			const wanted = Math.ceil(size / DATA_ROW_BYTES)
			const rows = Math.min(wanted, MAX_DATA_ROWS)
			for (let row = 0; row < rows; row += 1) {
				const address = entry.address + row * DATA_ROW_BYTES
				const bytes: number[] = []
				for (let offset = 0; offset < DATA_ROW_BYTES && address + offset < entry.address + size; offset += 1) {
					bytes.push(current.readByte(address + offset))
				}
				addRow(entry.sourceLine, {
					address,
					word: null,
					bytes,
					directive: entry.directive,
					offset: row * DATA_ROW_BYTES,
					truncated: row === rows - 1 && wanted > rows,
				})
			}
		}

		return codeWords
	}

	const simulatorView = () => {
		if (!simulator) return {}
		const state = simulator.getState()
		return {
			registers: state.registers,
			memory: state.memory,
			console: state.console,
			pc: state.pc,
			halted: state.halted,
			instructionCount: state.instructionCount,
			isRunning: false,
			isPaused: state.paused,
			executionHistory: simulator.getExecutionHistory(),
			breakpoints: new Set(simulator.getBreakpoints()),
			sourceMap: new Map(simulator.program.sourceMap),
			codeWords: entryCodeWords(simulator),
			labels: new Map(simulator.program.labels),
			callStack: state.callStack,
			selectedFrame: null,
			pendingInput: state.pendingInput,
			keyboardDisplay: state.keyboardDisplay,
			fpRegisters: state.fpRegisters,
			fpConditionFlags: state.fpConditionFlags,
			cp0Registers: state.cp0Registers,
			...toolView(),
		}
	}

	/** Addresses that own a source line, which is all the editor can point at. */
	const visibleAddresses = (current: MipsSimulator) => new Set(current.program.sourceMap.values())

	/**
	 * A word with no line of its own, such as the tail of a pseudo-instruction, is
	 * worth stopping at only while the disassembly column shows it.  Breakpoints
	 * and the end of the program always win.
	 */
	let hiddenWordGuard = 0
	const atHiddenWord = (current: MipsSimulator, visible: Set<number>) => {
		if (hiddenWordGuard > 10000) return false
		if (get().gutterColumns.disassembly || current.halted || current.paused) return false
		if (current.breakpoints.has(current.pc) || visible.has(current.pc)) return false
		hiddenWordGuard += 1
		return true
	}

	const ensureSimulator = () => {
		if (!simulator) {
			const state = get()
			const created = createSimulator(state.breakpointLines)
			simulator = created.simulator
			set({ breakpointLines: created.breakpointLines })
		}
		return simulator
	}

	const resetExecution = () => ({
		registers: initialRegisters,
		memory: {},
		console: '',
		currentLine: 0,
		pc: 0x00400000,
		halted: false,
		instructionCount: 0,
		sourceMap: new Map<number, number>(),
		codeWords: new Map<number, CodeWord[]>(),
		labels: new Map<string, number>(),
		callStack: [],
		selectedFrame: null,
		pendingInput: null,
		keyboardDisplay: { queuedInput: '', displayOutput: '' },
		isRunning: false,
		isPaused: false,
		breakpoints: new Set<number>(),
		executionHistory: [],
		...initialCoprocessorState(),
	})

	return {
		code: INITIAL_CODE,
		documents: [{ id: 'main', title: 'main.asm', code: INITIAL_CODE, dirty: false }],
		activeDocumentId: 'main',
		assembleAllFiles: readStoredSetting(ASSEMBLE_ALL_SETTING, false, isBoolean),
		delayedBranching: readStoredSetting(DELAYED_BRANCHING_SETTING, false, isBoolean),
		...resetExecution(),
		breakpointLines: new Set<number>(),
		breakpointAddresses: new Set<number>(),
		hoveredAddress: null,
		selectedFrame: null,
		// A setting saved before a column existed still names the ones it knew about.
		gutterColumns: { ...DEFAULT_GUTTER_COLUMNS, ...readStoredSetting(GUTTER_SETTING, DEFAULT_GUTTER_COLUMNS, isFlagSet(['code', 'disassembly'])) },
		heatMap: readStoredSetting(HEAT_MAP_SETTING, false, (value) => typeof value === 'boolean'),
		heatMapLines: readStoredSetting(HEAT_MAP_LINES_SETTING, false, (value) => typeof value === 'boolean'),
		findReplaceOpen: false,
		runToken: 0,
		consoleAttention: 'none',
		hasSavedProgram: getSavedProgram() !== null,
		runSpeed: readStoredSetting<number | null>(RUN_SPEED_SETTING, null, (value) => RUN_SPEEDS.includes(value as number | null)),
		statistics: new InstructionStatistics().snapshot(),
		profile: new ExecutionProfile().snapshot(),
		cache: cache.snapshot(),
		cacheSettings: initialCacheSettings,
		branchHistory: branchHistory.snapshot(),
		branchHistorySettings: initialBranchHistorySettings,
		pipeline: pipeline.snapshot(),
		pipelineSettings: initialPipelineSettings,

		setCode: (newCode) => {
			simulator = null
			set((state) => ({
				code: newCode,
				documents: state.documents.map((document) => document.id === state.activeDocumentId
					? { ...document, code: newCode, dirty: true }
					: document),
				...resetExecution(),
			}))
		},

		// Editing a file that is not the entry point still invalidates the
		// program, since `.include` and the all-files setting can pull it in.
		setDocumentCode: (documentId, newCode) => {
			const state = get()
			if (documentId === state.activeDocumentId) {
				state.setCode(newCode)
				return
			}
			simulator = null
			set({
				documents: state.documents.map((document) => document.id === documentId
					? { ...document, code: newCode, dirty: true }
					: document),
				...resetExecution(),
			})
		},

		setAssembleAllFiles: (assembleAllFiles) => {
			simulator = null
			writeStoredSetting(ASSEMBLE_ALL_SETTING, assembleAllFiles)
			set({ assembleAllFiles, ...resetExecution() })
		},

		// The setting reaches the assembler as well, so the program has to be
		// built again rather than merely restarted.
		setDelayedBranching: (delayedBranching) => {
			simulator = null
			writeStoredSetting(DELAYED_BRANCHING_SETTING, delayedBranching)
			set({ delayedBranching, ...resetExecution() })
		},

		saveProgram: () => {
			try {
				const state = get()
				const program: SavedProgram = {
					version: SAVED_PROGRAM_VERSION,
					code: state.code,
					savedAt: new Date().toISOString(),
					documents: state.documents.map((document) => ({ ...document, dirty: false })),
					activeDocumentId: state.activeDocumentId,
					assembleAllFiles: state.assembleAllFiles,
				}
				window.localStorage.setItem(SAVED_PROGRAM_KEY, JSON.stringify(program))
				set({ hasSavedProgram: true })
				return true
			} catch {
				return false
			}
		},

		loadProgram: () => {
			const program = getSavedProgram()
			if (!program) return false
			const documents = hasSavedDocuments(program)
				? program.documents.map((document) => ({ ...document, dirty: false }))
				: [{ id: 'main', title: 'main.asm', code: program.code, dirty: false }]
			const activeDocumentId = hasSavedDocuments(program) ? program.activeDocumentId : documents[0].id
			const activeDocument = documents.find((document) => document.id === activeDocumentId)!
			simulator = null
			set({
				code: activeDocument.code,
				documents,
				activeDocumentId,
				assembleAllFiles: program.assembleAllFiles === true,
				hasSavedProgram: true,
				...resetExecution(),
			})
			return true
		},

		exportHexText: () => {
			try {
				const { files, entries } = assemblySources()
				const { machineCode } = new Assembler(files, entries).assemble()
				downloadHexText(machineCode)
				return true
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}` })
				return false
			}
		},

		createDocument: () => {
			const id = `source-${Date.now()}`
			const document: SourceDocument = {
				id,
				title: `untitled-${get().documents.length + 1}.asm`,
				code: '',
				dirty: false,
			}
			simulator = null
			set((state) => ({
				documents: [...state.documents, document],
				activeDocumentId: id,
				code: document.code,
				...resetExecution(),
			}))
		},

		selectDocument: (documentId) => {
			const document = get().documents.find((candidate) => candidate.id === documentId)
			if (!document || document.id === get().activeDocumentId) return
			simulator = null
			set({ activeDocumentId: document.id, code: document.code, ...resetExecution() })
		},

		renameDocument: (documentId, title) => {
			simulator = null
			set((state) => ({
				documents: state.documents.map((document) => document.id === documentId ? { ...document, title, dirty: true } : document),
				...resetExecution(),
			}))
		},

		closeDocument: (documentId) => {
			const state = get()
			if (!state.documents.some((document) => document.id === documentId)) return
			const documents = state.documents.filter((document) => document.id !== documentId)
			const remainingDocuments = documents.length ? documents : [{ id: `source-${Date.now()}`, title: 'untitled.asm', code: '', dirty: false }]
			const activeDocument = documentId === state.activeDocumentId
				? remainingDocuments[Math.max(0, state.documents.findIndex((document) => document.id === documentId) - 1)]
				: remainingDocuments.find((document) => document.id === state.activeDocumentId)!
			simulator = null
			set({
				documents: remainingDocuments,
				activeDocumentId: activeDocument.id,
				code: activeDocument.code,
				...resetExecution(),
			})
		},

		refreshAssembly: () => {
			try {
				const state = get()
				const created = createSimulator(state.breakpointLines)
				simulator = created.simulator
				set({ ...simulatorView(), breakpointLines: created.breakpointLines })
			} catch {
				// Half-written source is expected here; the Assemble button reports errors.
			}
		},

		assemble: () => {
			try {
				const state = get()
				const created = createSimulator(state.breakpointLines)
				simulator = created.simulator
				set({ ...simulatorView(), breakpointLines: created.breakpointLines })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}` })
			}
		},

		setRunSpeed: (speed) => {
			if (simulator) simulator.speed = speed
			writeStoredSetting(RUN_SPEED_SETTING, speed)
			set({ runSpeed: speed })
		},

		setCacheSettings: (settings) => {
			cache.configure(settings)
			writeStoredSetting(CACHE_SETTING, settings)
			set({ cacheSettings: settings, cache: cache.snapshot() })
		},

		setBranchHistorySettings: (settings) => {
			branchHistory.configure(settings)
			writeStoredSetting(BRANCH_HISTORY_SETTING, settings)
			set({ branchHistorySettings: settings, branchHistory: branchHistory.snapshot() })
		},

		setPipelineSettings: (settings) => {
			pipeline.configure(settings)
			writeStoredSetting(PIPELINE_SETTING, settings)
			set({ pipelineSettings: settings, pipeline: pipeline.snapshot() })
		},

		submitInput: async (input, cancelled = false) => {
			if (!simulator || !simulator.provideInput(input, cancelled)) return
			await simulator.continue()
			set(simulatorView())
		},

		sendKeyboardInput: (input) => {
			if (!input || !simulator) return
			simulator.queueKeyboardInput(input)
			set(simulatorView())
		},

		setRegisters: (newRegisters) => set({ registers: newRegisters }),

		setMemory: (newMemory) => set({ memory: newMemory }),

		appendConsole: (text) =>
			set((state) => ({
				console: state.console + text,
			})),

		clearConsole: () => set({ console: '' }),

		run: async (): Promise<void> => {
			const state = get()
			const created = createSimulator(state.breakpointLines)
			simulator = created.simulator
			set({
				isRunning: true,
				isPaused: false,
				pendingInput: null,
				breakpointLines: created.breakpointLines,
				runToken: get().runToken + 1,
				consoleAttention: 'none',
			})
			await simulator.run()
			set(simulatorView())
		},

		step: () => {
			try {
				hiddenWordGuard = 0
				const current = ensureSimulator()
				const visible = visibleAddresses(current)
				current.step()
				while (atHiddenWord(current, visible)) current.step()
				set({ ...simulatorView(), isPaused: true })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}` })
			}
		},

		stepBack: () => {
			if (!simulator) return
			simulator.stepBack()
			set(simulatorView())
		},

		stepOver: async () => {
			try {
				hiddenWordGuard = 0
				const current = ensureSimulator()
				const visible = visibleAddresses(current)
				await current.stepOver()
				while (atHiddenWord(current, visible)) await current.stepOver()
				set({ ...simulatorView(), isPaused: true })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}` })
			}
		},

		stepToReturn: async () => {
			try {
				await ensureSimulator().stepToReturn()
				set({ ...simulatorView(), isPaused: true })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}` })
			}
		},

		pause: () => {
			if (simulator) {
				simulator.paused = true
				simulator.running = false
				set(simulatorView())
			}
		},

		runToAddress: async (address) => {
			try {
				const current = ensureSimulator()
				const wanted = current.breakpoints.has(address)
				current.breakpoints.add(address)
				set({ isRunning: true, isPaused: false })
				await current.continue()
				if (!wanted) current.breakpoints.delete(address)
				set({ ...simulatorView(), isPaused: !current.halted })
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				set({ console: `Error: ${message}`, isRunning: false })
			}
		},

		setProgramCounter: (address) => {
			const current = ensureSimulator()
			current.pc = address >>> 0
			current.halted = false
			set({ ...simulatorView(), isPaused: true })
		},

		continue: async () => {
			if (simulator) {
				await simulator.continue()
				set(simulatorView())
			}
		},

		addBreakpoint: (address) => {
			if (simulator) simulator.addBreakpoint(address)
			set((state) => ({ breakpoints: new Set(simulator?.getBreakpoints() || [...state.breakpoints, address]) }))
		},

		removeBreakpoint: (address) => {
			if (simulator) simulator.removeBreakpoint(address)
			set((state) => ({
				breakpoints: simulator ? new Set(simulator.getBreakpoints()) : new Set([...state.breakpoints].filter((item) => item !== address)),
			}))
		},

		toggleBreakpoint: (address) => {
			if (simulator) simulator.toggleBreakpoint(address)
			set((state) => {
				const breakpoints = simulator
					? new Set(simulator.getBreakpoints())
					: new Set(state.breakpoints)
				if (!simulator) {
					if (breakpoints.has(address)) breakpoints.delete(address)
					else breakpoints.add(address)
				}
				return { breakpoints }
			})
		},

		toggleBreakpointAddress: (address) => {
			const breakpointAddresses = new Set(get().breakpointAddresses)
			if (breakpointAddresses.has(address)) breakpointAddresses.delete(address)
			else breakpointAddresses.add(address)
			simulator?.toggleBreakpoint(address)
			set({ breakpointAddresses, breakpoints: new Set(simulator?.getBreakpoints() ?? breakpointAddresses) })
		},

		toggleBreakpointLine: (line) => {
			const state = get()
			const address = state.sourceMap.get(line)
			if (state.sourceMap.size > 0 && address === undefined) return
			const breakpointLines = new Set(state.breakpointLines)
			if (breakpointLines.has(line)) breakpointLines.delete(line)
			else breakpointLines.add(line)
			if (simulator && address !== undefined) simulator.toggleBreakpoint(address)
			set({
				breakpointLines,
				breakpoints: simulator ? new Set(simulator.getBreakpoints()) : new Set(),
			})
		},

		setHoveredAddress: (address) => set({ hoveredAddress: address }),

		setSelectedFrame: (frame) => set({ selectedFrame: frame }),

		setConsoleAttention: (attention) => set({ consoleAttention: attention }),

		setGutterColumns: (columns) => {
			// A paced run animates whatever the editor can point at, which the
			// disassembly column widens to every machine word.
			if (simulator) simulator.pacedAddresses = columns.disassembly ? null : visibleAddresses(simulator)
			writeStoredSetting(GUTTER_SETTING, columns)
			set({ gutterColumns: columns })
		},

		setHeatMap: (shown) => {
			writeStoredSetting(HEAT_MAP_SETTING, shown)
			set({ heatMap: shown })
		},

		setHeatMapLines: (shown) => {
			writeStoredSetting(HEAT_MAP_LINES_SETTING, shown)
			set({ heatMapLines: shown })
		},

		setFindReplaceOpen: (open) => set({ findReplaceOpen: open }),

		setBreakpointLines: (lines) => {
			set({ breakpointLines: new Set([...lines].filter((line) => Number.isInteger(line) && line > 0)) })
		},

		reset: () => {
			simulator = null
			set({
				...resetExecution(),
				breakpointLines: new Set(),
				breakpointAddresses: new Set(),
			})
			// Leave the freshly assembled program in memory rather than a blank view.
			get().refreshAssembly()
		},
	}
})

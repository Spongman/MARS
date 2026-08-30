import { create } from 'zustand'
import { Assembler, type SourceFile } from '../core/assembler'
import { CP0_REGISTER_COUNT, CP0_STATUS_INITIAL, FP_CONDITION_FLAG_COUNT, FP_REGISTER_COUNT } from '../core/coprocessor'
import { hasErrors } from '../core/diagnostics'
import { MipsSimulator } from '../core/simulator'
import { EMPTY_SOURCE_INDEX, type SourceIndex, type SourceRow } from '../core/sourceIndex'
import type { CallFrame, CodeWord, CoprocessorState, Diagnostic, KeyboardDisplayState, MemoryView, PendingInput, Registers } from '../core/types'
import { DebugSession } from '../debug/session'
import { isFlagSet, readStoredSetting, writeStoredSetting } from '../hooks/useStoredState'
import { downloadHexText } from '../services/hexTextExport'
import type { BranchHistorySettings, BranchHistorySnapshot } from '../tools/branchHistory'
import type { CacheSettings, CacheSnapshot } from '../tools/cache'
import type { PipelineSettings, PipelineSnapshot } from '../tools/pipeline'
import type { ProfileSnapshot } from '../tools/profile'
import { createToolRegistry } from '../tools/registry'
import type { StatisticsSnapshot } from '../tools/statistics'

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
const HEAT_MAP_LINES_SETTING = 'source.heatmap.lines'

const isBoolean = (value: unknown) => typeof value === 'boolean'

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
	pc: number
	halted: boolean
	instructionCount: number
	/** Which line of which file every machine word of the program came from. */
	sourceIndex: SourceIndex
	/** Everything wrong with the source, as the editor marks it up. */
	diagnostics: Diagnostic[]
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
	toggleBreakpointLine: (line: number) => void
	toggleBreakpointAddress: (address: number) => void
	setBreakpointLines: (lines: Iterable<number>) => void
	setHoveredAddress: (address: number | null) => void
	setSelectedFrame: (frame: number | null) => void
	setGutterColumns: (columns: GutterColumns) => void
	setHeatMap: (shown: boolean) => void
	setHeatMapLines: (shown: boolean) => void
	setConsoleAttention: (attention: 'none' | 'output' | 'input') => void
	/** Assembles without reporting failures, to keep the memory view current while editing. */
	refreshAssembly: () => void
	reset: () => void
}

export const useTHRAXStore = create<THRAXStore>((set, get) => {
	// A setting saved before a column existed still names the ones it knew about.
	const savedGutterColumns: GutterColumns = { ...DEFAULT_GUTTER_COLUMNS, ...readStoredSetting(GUTTER_SETTING, DEFAULT_GUTTER_COLUMNS, isFlagSet(['code', 'disassembly'])) }

	/** Stepping policy, breakpoints, and the runtime they drive. */
	const debug = new DebugSession(() => ensureSimulator())
	debug.setWordRows(savedGutterColumns.disassembly)

	/**
	 * Every open tab is visible to `.include`; which of them are assembled into
	 * the program depends on the multi-file setting.  The active tab comes first,
	 * so it is the entry file, whose lines the editor is decorated with.
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

	const tools = createToolRegistry()
	// Tool settings outlive the session, so the tools start configured as they
	// were left rather than at their defaults.
	const toolSettings = tools.loadSettings()

	/** A simulator over the assembled program, or the diagnostics that stopped it. */
	const createSimulator = (): { simulator: MipsSimulator | null, diagnostics: Diagnostic[] } => {
		const { files, entries } = assemblySources()
		const { delayedBranching } = get()
		const assembler = new Assembler(files, entries, { delayedBranching })
		const { program, machineCode, diagnostics } = assembler.assemble()
		// A program that did not assemble is not worth loading; its diagnostics stand
		// for it, and the stale program it would have replaced is let go.
		if (hasErrors(diagnostics)) {
			debug.detach()
			return { simulator: null, diagnostics }
		}
		const nextSimulator = new MipsSimulator(machineCode, program)
		nextSimulator.delayedBranching = delayedBranching
		nextSimulator.configure({ speed: get().runSpeed })
		// A paced run is worth watching, so refresh the workspace between batches.
		nextSimulator.onProgress = () => set({ ...simulatorView(), ...tools.views(), isRunning: true, isPaused: false })
		tools.attach(nextSimulator, { delayedBranching })
		// Breakpoints and the addresses worth stopping at outlive re-assembly.
		debug.rebind(nextSimulator, program.sourceIndex)
		return { simulator: nextSimulator, diagnostics }
	}

	/**
	 * Diagnostics reach the editor as markers; the console keeps the one line per
	 * error it printed before there were any.
	 */
	const report = (diagnostics: Diagnostic[]) => {
		const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
		return errors.length === 0
			? { diagnostics }
			: { diagnostics, console: errors.map((error) => `Error: ${error.message}`).join('\n') }
	}

	/** An exception no pass turned into a diagnostic is reported as one. */
	const reportException = (error: unknown) => report([{ severity: 'error', message: error instanceof Error ? error.message : String(error) }])

	/**
	 * The index says which words a line owns; the bytes are read live, so data
	 * the program has written to shows what it holds now.
	 */
	const codeWordFor = (row: SourceRow, current: MipsSimulator): CodeWord => {
		if (row.instruction === null) {
			const bytes = Array.from({ length: row.length ?? 0 }, (_, offset) => current.readByte(row.address + offset))
			return { address: row.address, word: null, bytes, directive: row.directive, offset: row.offset, truncated: row.truncated }
		}
		const word = current.machineCode[row.instruction] ?? 0
		return { address: row.address, word, bytes: [0, 1, 2, 3].map((offset) => (word >>> (24 - offset * 8)) & 0xff) }
	}

	/** Groups the assembled bytes of the entry file under the line that wrote them. */
	const entryCodeWords = (current: MipsSimulator) => {
		const index = current.program.sourceIndex
		return new Map([...index.lines(index.entryFile)].map(([line, rows]) => [line, rows.map((row) => codeWordFor(row, current))]))
	}

	const simulatorView = () => {
		const simulator = debug.machine
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
			sourceIndex: simulator.program.sourceIndex,
			codeWords: entryCodeWords(simulator),
			labels: new Map(simulator.program.labels),
			callStack: state.callStack,
			selectedFrame: null,
			pendingInput: state.pendingInput,
			keyboardDisplay: state.keyboardDisplay,
			fpRegisters: state.fpRegisters,
			fpConditionFlags: state.fpConditionFlags,
			cp0Registers: state.cp0Registers,
			...tools.views(),
		}
	}

	/** Builds the program a debug control was pressed before there was one. */
	function ensureSimulator(): MipsSimulator | null {
		const created = createSimulator()
		set({ ...debug.view(), ...report(created.diagnostics) })
		return created.simulator
	}

	/**
	 * Runs one debug control and publishes what it did.  A control with no
	 * program to drive says so rather than throwing, and a fault in the program
	 * is reported as a diagnostic.
	 */
	const controlled = (action: () => boolean, after: Partial<THRAXStore> = {}) => {
		try {
			// Nothing to drive still clears the run flag the caller may have raised.
			set(action() ? { ...simulatorView(), ...after } : { isRunning: false })
		} catch (error) {
			set({ ...reportException(error), isRunning: false })
		}
	}

	const controlledAsync = async (action: () => Promise<boolean>, after: () => Partial<THRAXStore> = () => ({})) => {
		try {
			set((await action()) ? { ...simulatorView(), ...after() } : { isRunning: false })
		} catch (error) {
			set({ ...reportException(error), isRunning: false })
		}
	}

	const paused = { isPaused: true }

	const resetExecution = () => ({
		registers: initialRegisters,
		memory: {},
		console: '',
		pc: 0x00400000,
		halted: false,
		instructionCount: 0,
		sourceIndex: EMPTY_SOURCE_INDEX,
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
		diagnostics: [],
		hoveredAddress: null,
		selectedFrame: null,
		gutterColumns: savedGutterColumns,
		heatMap: readStoredSetting(HEAT_MAP_SETTING, false, (value) => typeof value === 'boolean'),
		heatMapLines: readStoredSetting(HEAT_MAP_LINES_SETTING, false, (value) => typeof value === 'boolean'),
		runToken: 0,
		consoleAttention: 'none',
		hasSavedProgram: getSavedProgram() !== null,
		runSpeed: readStoredSetting<number | null>(RUN_SPEED_SETTING, null, (value) => RUN_SPEEDS.includes(value as number | null)),
		...tools.views(),
		cacheSettings: toolSettings.cache,
		branchHistorySettings: toolSettings.branchHistory,
		pipelineSettings: toolSettings.pipeline,

		setCode: (newCode) => {
			debug.detach()
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
			debug.detach()
			set({
				documents: state.documents.map((document) => document.id === documentId
					? { ...document, code: newCode, dirty: true }
					: document),
				...resetExecution(),
			})
		},

		setAssembleAllFiles: (assembleAllFiles) => {
			debug.detach()
			writeStoredSetting(ASSEMBLE_ALL_SETTING, assembleAllFiles)
			set({ assembleAllFiles, ...resetExecution() })
		},

		// The setting reaches the assembler as well, so the program has to be
		// built again rather than merely restarted.
		setDelayedBranching: (delayedBranching) => {
			debug.detach()
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
			debug.detach()
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
				const { machineCode, diagnostics } = new Assembler(files, entries).assemble()
				set(report(diagnostics))
				if (hasErrors(diagnostics)) return false
				downloadHexText(machineCode)
				return true
			} catch (error) {
				set(reportException(error))
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
			debug.detach()
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
			debug.detach()
			set({ activeDocumentId: document.id, code: document.code, ...resetExecution() })
		},

		renameDocument: (documentId, title) => {
			debug.detach()
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
			debug.detach()
			set({
				documents: remainingDocuments,
				activeDocumentId: activeDocument.id,
				code: activeDocument.code,
				...resetExecution(),
			})
		},

		// Half-written source is expected here, so the diagnostics reach the editor
		// live while the console is left to the Assemble button and to running.
		refreshAssembly: () => {
			try {
				const created = createSimulator()
				if (!created.simulator) {
					set({ diagnostics: created.diagnostics })
					return
				}
				set({ ...simulatorView(), ...debug.view(), diagnostics: created.diagnostics })
			} catch (error) {
				set({ diagnostics: reportException(error).diagnostics })
			}
		},

		assemble: () => {
			try {
				const created = createSimulator()
				set({
					...(created.simulator ? simulatorView() : {}),
					...debug.view(),
					...report(created.diagnostics),
				})
			} catch (error) {
				set(reportException(error))
			}
		},

		setRunSpeed: (speed) => {
			debug.machine?.configure({ speed })
			writeStoredSetting(RUN_SPEED_SETTING, speed)
			set({ runSpeed: speed })
		},

		setCacheSettings: (settings) => {
			tools.setSettings('cache', settings)
			set({ cacheSettings: settings, ...tools.views() })
		},

		setBranchHistorySettings: (settings) => {
			tools.setSettings('branchHistory', settings)
			set({ branchHistorySettings: settings, ...tools.views() })
		},

		setPipelineSettings: (settings) => {
			tools.setSettings('pipeline', settings)
			set({ pipelineSettings: settings, ...tools.views() })
		},

		submitInput: async (input, cancelled = false) => {
			if (!debug.machine?.provideInput(input, cancelled)) return
			await debug.continue()
			set(simulatorView())
		},

		sendKeyboardInput: (input) => {
			if (!input || !debug.machine) return
			debug.machine.queueKeyboardInput(input)
			set(simulatorView())
		},

		// Assembly failures are reported, not thrown: only an unexpected exception
		// reaches the error bar above the workspace.
		run: async (): Promise<void> => {
			const created = createSimulator()
			if (!created.simulator) {
				set({ ...debug.view(), ...report(created.diagnostics) })
				return
			}
			set({
				isRunning: true,
				isPaused: false,
				pendingInput: null,
				...debug.view(),
				diagnostics: created.diagnostics,
				runToken: get().runToken + 1,
				consoleAttention: 'none',
			})
			await created.simulator.run()
			set(simulatorView())
		},

		step: () => controlled(() => debug.step(), paused),

		stepBack: () => controlled(() => debug.stepBack()),

		stepOver: () => controlledAsync(() => debug.stepOver(), () => paused),

		stepToReturn: () => controlledAsync(() => debug.stepToReturn(), () => paused),

		pause: () => controlled(() => debug.pause()),

		runToAddress: (address) => {
			set({ isRunning: true, isPaused: false })
			return controlledAsync(() => debug.runTo(address), () => ({ isPaused: !debug.machine?.halted }))
		},

		setProgramCounter: (address) => controlled(() => debug.setProgramCounter(address), paused),

		continue: () => controlledAsync(() => debug.continue()),

		toggleBreakpointAddress: (address) => {
			if (debug.toggleBreakpointAddress(address)) set(debug.view())
		},

		toggleBreakpointLine: (line) => {
			if (debug.toggleBreakpointLine(line)) set(debug.view())
		},

		setHoveredAddress: (address) => set({ hoveredAddress: address }),

		setSelectedFrame: (frame) => set({ selectedFrame: frame }),

		setConsoleAttention: (attention) => set({ consoleAttention: attention }),

		setGutterColumns: (columns) => {
			// Word rows widen what stepping stops at, and what a paced run animates,
			// to every machine word rather than the first word of each line.
			debug.setWordRows(columns.disassembly)
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

		setBreakpointLines: (lines) => {
			debug.setBreakpointLines(lines)
			set(debug.view())
		},

		reset: () => {
			debug.clear()
			set({
				...resetExecution(),
				...debug.view(),
			})
			// Leave the freshly assembled program in memory rather than a blank view.
			get().refreshAssembly()
		},
	}
})

export type TokenType =
	| 'COMMA'
	| 'COLON'
	| 'DIRECTIVE'
	| 'DOLLAR'
	| 'EOF'
	| 'IDENTIFIER'
	| 'INSTRUCTION'
	| 'LABEL'
	| 'LPAREN'
	| 'MINUS'
	| 'NEWLINE'
	| 'NUMBER'
	| 'PLUS'
	| 'RPAREN'
	| 'STRING'

export interface TokenData {
	type: TokenType
	value: string
	line: number
	column: number
	/** Source file the token came from, for multi-file assembly. */
	file?: string
}

export interface RegisterArgument { type: 'register'; value: string }
export interface ImmediateArgument { type: 'immediate'; value: number }
/** `offset` carries the constant of an expression such as `arr+4`. */
export interface LabelArgument { type: 'label'; value: string; offset?: number; address?: number }
export interface StringArgument { type: 'string'; value: string }
export interface MemoryArgument { type: 'memory'; offset: ImmediateArgument | LabelArgument; register: string }

export type MipsArgument = RegisterArgument | ImmediateArgument | LabelArgument | StringArgument | MemoryArgument

export interface DataValue { value: ImmediateArgument | LabelArgument; width: number }
export interface DataEntry {
	address: number
	bytes: Array<number | DataValue>
	/** The directive that wrote these bytes, such as `.word` or `.float`. */
	directive?: string
	/** Line and file of the directive, for the editor's gutter. */
	sourceLine?: number
	sourceFile?: string
}
/** Segments an instruction can live in; `.data` and `.kdata` hold no instructions. */
export type TextSegment = 'text' | 'ktext'
export type Segment = TextSegment | 'data' | 'kdata'

export interface MipsInstruction {
	name: string
	args: MipsArgument[]
	labels: string[]
	address: number | null
	sourceLine: number
	sourceFile?: string
	segment?: TextSegment
}

/** Labels left dangling at the end of a text segment, resolved after layout. */
export interface SegmentEndLabels { segment: TextSegment; labels: string[] }

export interface MipsProgram {
	instructions: MipsInstruction[]
	labels: Map<string, number>
	data: DataEntry[]
	/** Line-to-address map of the entry file, kept for single-file callers. */
	sourceMap: Map<number, number>
	/** Line-to-address map per source file name. */
	sourceMaps?: Map<string, Map<number, number>>
	segmentEndLabels?: SegmentEndLabels[]
	segmentStarts?: Record<TextSegment, number>
}

/** One gutter row: the bytes at `address`, and the instruction word when it is code. */
export interface CodeWord {
	address: number
	word: number | null
	bytes: number[]
	/** Directive that wrote a data row's bytes, which is how it reads back. */
	directive?: string
	/** Byte offset of a data row within that directive's data. */
	offset?: number
	/** Set on the last row of data too long to show in full. */
	truncated?: boolean
}

export type Registers = Record<string, number>

/** Coprocessor register files, held as raw 32-bit words. */
export interface CoprocessorState {
	/** `$f0`-`$f31` raw bit patterns; doubles occupy an even/odd pair. */
	fpRegisters: number[]
	/** The eight CP1 condition codes set by `c.eq.s` and friends. */
	fpConditionFlags: boolean[]
	/** CP0 registers, of which THRAX shows vaddr, status, cause, and epc. */
	cp0Registers: number[]
}

export type MemoryView = Record<string, number>

/** State exposed by the THRAX Keyboard and Display MMIO tool. */
export interface KeyboardDisplayState {
	queuedInput: string
	displayOutput: string
}

/** One memory word as it stood before an instruction wrote to it. */
export interface MemoryUndoEntry {
	wordAddress: number
	/** The previous value, or undefined when the word did not exist. */
	value: number | undefined
}

export interface ExecutionSnapshot extends CoprocessorState {
	address: number
	/** Source metadata for the executed word, when the debugger has any. */
	instruction: MipsInstruction | null
	registers: Registers
	/** Only what this instruction changed, so a snapshot costs what it writes. */
	memoryUndo: MemoryUndoEntry[]
	console: string
	pc: number
	hi: number
	lo: number
	instructionCount: number
	halted: boolean
	paused: boolean
	callStack: CallFrame[]
	heapPointer: number
	keyboardDisplay: KeyboardDisplayState
	/** A delayed branch in flight, so backstepping into a delay slot resumes it. */
	delayState: 'none' | 'registered' | 'triggered'
	delayedTarget: number
}

export interface CallFrame {
	callAddress: number
	returnAddress: number
	targetAddress: number
}

export interface PendingInput {
	type: 'integer' | 'string' | 'character' | 'float' | 'double' | 'confirm'
	maximumLength?: number
	/** Where a string read is stored; syscall 8 and 54 disagree on the register. */
	bufferAddress?: number
	/** Shown instead of the generic prompt, for the dialog syscalls. */
	prompt?: string
	/** Dialog reads report an outcome in `$a1` and can be cancelled. */
	dialog?: boolean
}

export interface SimulatorState extends CoprocessorState {
	registers: Registers
	memory: MemoryView
	console: string
	pc: number
	hi: number
	lo: number
	instructionCount: number
	paused: boolean
	halted: boolean
	callStack: CallFrame[]
	pendingInput: PendingInput | null
	heapPointer: number
	keyboardDisplay: KeyboardDisplayState
}

/**
 * MIPS Parser - Converts tokens into an AST
 */

import { doubleToBits, singleToBits } from './coprocessor'
import { AssemblyError, at } from './diagnostics'
import type {
	DataEntry,
	DataValue,
	ImmediateArgument,
	LabelArgument,
	MemoryArgument,
	MipsArgument,
	Segment,
	SegmentEndLabels,
	TextSegment,
	TokenData,
} from './types'

/** Default base address of each segment, as in THRAX. */
const SEGMENT_STARTS: Record<Segment, number> = {
	text: 0x00400000,
	data: 0x10010000,
	ktext: 0x80000000,
	kdata: 0x90000000,
}

/** Data segments lay out here; the assembler places the text segments. */
type DataSegment = 'data' | 'kdata'

const DATA_DIRECTIVES = ['.word', '.half', '.byte', '.float', '.double', '.ascii', '.asciiz', '.space']

function isTextSegment(segment: Segment): segment is TextSegment {
	return segment === 'text' || segment === 'ktext'
}

/** Little-endian IEEE 754 bytes for a `.float` or `.double` initializer. */
function floatBytes(value: number, width: number): number[] {
	if (width === 4) {
		const bits = singleToBits(value)
		return [0, 1, 2, 3].map((index) => (bits >>> (index * 8)) & 0xff)
	}
	const { low, high } = doubleToBits(value)
	return [...[0, 1, 2, 3].map((index) => (low >>> (index * 8)) & 0xff), ...[0, 1, 2, 3].map((index) => (high >>> (index * 8)) & 0xff)]
}

export class Instruction {
	address: number | null = null

	constructor(
		public name: string,
		public args: MipsArgument[] = [],
		public labels: string[] = [],
		public sourceLine = 0,
		public sourceFile = '',
		public segment: TextSegment = 'text',
		public sourceColumn = 0,
	) {}
}

/**
 * What one parse produced.  Instructions arrive without addresses: they only
 * get them once the assembler has expanded the pseudo-instructions between
 * them, so text layout is the assembler's alone.
 */
export interface ParseResult {
	instructions: Instruction[]
	labels: Map<string, number>
	data: DataEntry[]
	/** Text labels with no instruction after them; the assembler places them. */
	segmentEndLabels: SegmentEndLabels[]
	/** Base address of each text segment, which `.text 0x...` may override. */
	segmentStarts: Record<TextSegment, number>
}

export class Parser {
	pos: number
	instructions: Instruction[]
	labels: Map<string, number>
	data: DataEntry[]
	segment: Segment
	/** Where the next data directive lands; data labels bind to final addresses. */
	addresses: Record<DataSegment, number>
	/** Labels awaiting the next emission in their own segment. */
	pendingLabels: Record<Segment, string[]>
	segmentStarts: Record<TextSegment, number>
	segmentEndLabels: SegmentEndLabels[]
	definedLabels: Set<string>

	constructor(public tokens: TokenData[]) {
		this.tokens = tokens
		this.pos = 0
		this.instructions = []
		this.labels = new Map()
		this.data = []
		this.segment = 'text'
		this.addresses = { data: SEGMENT_STARTS.data, kdata: SEGMENT_STARTS.kdata }
		this.pendingLabels = { text: [], data: [], ktext: [], kdata: [] }
		this.segmentStarts = { text: SEGMENT_STARTS.text, ktext: SEGMENT_STARTS.ktext }
		this.segmentEndLabels = []
		this.definedLabels = new Set()
	}

	parse(): ParseResult {
		while (!this.isAtEnd()) {
			this.skipNewlines()
			if (this.isAtEnd()) break

			const token = this.peek()

			if (token.type === 'LABEL') {
				this.defineLabel(token.value, token)
				this.advance() // consume label
				this.consume('COLON', 'Expected ":" after label')
				this.skipNewlines()
				continue
			}

			if (token.type === 'DIRECTIVE') {
				this.parseDirective()
				continue
			}

			if (token.type === 'INSTRUCTION') {
				this.parseInstruction()
				continue
			}

			throw new AssemblyError(`Unexpected token "${token.value}"`, at(token))
		}

		this.flushPendingLabels()

		return {
			instructions: this.instructions,
			labels: this.labels,
			data: this.data,
			segmentEndLabels: this.segmentEndLabels,
			segmentStarts: this.segmentStarts,
		}
	}

	parseInstruction() {
		const instructionToken = this.consume('INSTRUCTION')
		const segment = this.segment
		if (!isTextSegment(segment)) {
			throw new AssemblyError(`Instruction in .${segment} segment`, at(instructionToken))
		}
		const args = this.parseArguments()
		const file = instructionToken.file ?? ''
		this.instructions.push(new Instruction(instructionToken.value.toUpperCase(), args, this.takePendingLabels(segment), instructionToken.line, file, segment, instructionToken.column))
		this.skipNewlines()
	}

	parseDirective() {
		const directiveToken = this.consume('DIRECTIVE')
		const name = directiveToken.value.toLowerCase()
		const args = this.parseArguments()

		if (name === '.text' || name === '.data' || name === '.ktext' || name === '.kdata') {
			this.segment = name.slice(1) as Segment
			// THRAX allows an explicit base address, as in `.ktext 0x80000180`.
			if (args.length > 0) this.setSegmentAddress(this.segment, this.requireImmediate(args[0], name, directiveToken), directiveToken)
		} else if (['.globl', '.global', '.set'].includes(name)) {
			// Linkage and assembler options do not emit anything here.
		} else if (name === '.extern') {
			this.addExtern(name, args, directiveToken)
		} else if (name === '.align') {
			if (this.segment !== 'data' && this.segment !== 'kdata') {
				throw new AssemblyError(`${name} is only supported in .data`, at(directiveToken))
			}
			const exponent = this.requireImmediate(args[0], name, directiveToken)
			if (exponent < 0 || exponent > 30) throw new AssemblyError(`Invalid alignment for ${name}`, at(directiveToken))
			const alignment = 2 ** exponent
			const segment = this.segment as DataSegment
			this.addresses[segment] = Math.ceil(this.addresses[segment] / alignment) * alignment
		} else if (DATA_DIRECTIVES.includes(name)) {
			if (this.segment !== 'data' && this.segment !== 'kdata') {
				throw new AssemblyError(`${name} is only supported in .data`, at(directiveToken))
			}
			this.addDataDirective(name, args, directiveToken)
		} else {
			throw new AssemblyError(`Unsupported directive: ${name}`, at(directiveToken))
		}
		this.skipNewlines()
	}

	setSegmentAddress(segment: Segment, address: number, token: TokenData) {
		// Pseudo-instructions expand after parsing, so a text segment can only be
		// based once: later instructions follow the ones already emitted.
		if (isTextSegment(segment)) {
			if (this.instructions.some((instruction) => instruction.segment === segment)) {
				throw new AssemblyError(`.${segment} cannot be restarted at a new address`, at(token))
			}
			this.segmentStarts[segment] = address
			return
		}
		this.addresses[segment] = address
	}

	/** `.extern name, size` reserves `size` zeroed bytes in the data segment. */
	addExtern(name: string, args: MipsArgument[], token: TokenData) {
		const label = args[0]
		if (!label || label.type !== 'label') throw new AssemblyError(`${name} expects a label`, at(token))
		const size = this.requireImmediate(args[1], name, token)
		if (size < 0) throw new AssemblyError(`${name} size must be non-negative`, at(token))

		const address = this.addresses.data
		this.definedLabels.add(label.value)
		this.labels.set(label.value, address)
		this.data.push({ address, bytes: new Array<number>(size).fill(0), directive: name, sourceLine: token.line, sourceFile: token.file ?? '' })
		this.addresses.data += size
	}

	addDataDirective(name: string, args: MipsArgument[], token: TokenData) {
		const segment = this.segment as DataSegment
		const start = this.addresses[segment]
		this.bindPendingLabels(segment, start)
		let bytes: Array<number | DataValue> = []

		if (name === '.space') {
			const length = this.requireImmediate(args[0], name, token)
			if (length < 0) throw new AssemblyError('.space length must be non-negative', at(token))
			bytes = new Array(length).fill(0)
		} else if (name === '.ascii' || name === '.asciiz') {
			for (const arg of args) {
				if (arg.type !== 'string') throw new AssemblyError(`${name} expects string operands`, at(token))
				for (let i = 0; i < arg.value.length; i++) bytes.push(arg.value.charCodeAt(i) & 0xff)
			}
			if (name === '.asciiz') bytes.push(0)
		} else if (name === '.float' || name === '.double') {
			for (const arg of args) {
				if (arg.type !== 'immediate') throw new AssemblyError(`${name} expects numeric operands`, at(token))
				bytes.push(...floatBytes(arg.value, name === '.float' ? 4 : 8))
			}
		} else {
			const width = name === '.word' ? 4 : name === '.half' ? 2 : 1
			for (const arg of args) {
				if (arg.type !== 'immediate' && arg.type !== 'label') {
					throw new AssemblyError(`${name} expects numeric or label operands`, at(token))
				}
				if (arg.type === 'immediate' && !Number.isInteger(arg.value)) {
					throw new AssemblyError(`${name} expects integer operands; use .float or .double`, at(token))
				}
				bytes.push({ value: arg, width })
			}
		}

		this.data.push({ address: start, bytes, directive: name, sourceLine: token.line, sourceFile: token.file ?? '' })
		this.addresses[segment] = start + bytes.reduce<number>((size, item) => size + (typeof item === 'number' ? 1 : item.width), 0)
	}

	defineLabel(name: string, token: TokenData) {
		if (this.definedLabels.has(name)) throw new AssemblyError(`Duplicate label: ${name}`, at(token))
		this.definedLabels.add(name)
		this.pendingLabels[this.segment].push(name)
	}

	takePendingLabels(segment: Segment): string[] {
		const labels = this.pendingLabels[segment]
		this.pendingLabels[segment] = []
		return labels
	}

	bindPendingLabels(segment: Segment, address: number) {
		for (const label of this.takePendingLabels(segment)) this.labels.set(label, address)
	}

	/**
	 * Labels left over at the end of input name the end of their segment.  Data
	 * addresses are already final; text addresses shift as pseudo-instructions
	 * expand, so the assembler resolves those once the layout is known.
	 */
	flushPendingLabels() {
		for (const segment of ['data', 'kdata'] as const) this.bindPendingLabels(segment, this.addresses[segment])
		for (const segment of ['text', 'ktext'] as const) {
			const labels = this.takePendingLabels(segment)
			if (labels.length > 0) this.segmentEndLabels.push({ segment, labels })
		}
	}

	requireImmediate(arg: MipsArgument | undefined, directive: string, token: TokenData): number {
		if (!arg || arg.type !== 'immediate') throw new AssemblyError(`${directive} expects an immediate value`, at(token))
		return arg.value
	}

	parseArguments(): MipsArgument[] {
		const args: MipsArgument[] = []

		while (!this.isAtEnd() && this.peek().type !== 'NEWLINE' && this.peek().type !== 'EOF') {
			const position = this.pos
			const arg = this.parseArgument()
			if (arg) args.push(arg)

			if (this.peek().type === 'COMMA') {
				this.advance()
			}
			// An argument that consumes nothing would spin here forever.
			if (this.pos === position) break
		}

		return args
	}

	parseArgument(): MipsArgument | null {
		const token = this.peek()

		if (token.type === 'DOLLAR') {
			this.advance()
			// Registers may be named by number, as in `$8` or `mfc0 $t0, $13`.
			if (this.peek().type === 'NUMBER') return { type: 'register', value: '$' + this.consume('NUMBER').value }
			const regToken = this.consume('IDENTIFIER', 'Expected register name')
			return { type: 'register', value: '$' + regToken.value }
		}

		if (['MINUS', 'PLUS', 'NUMBER', 'IDENTIFIER', 'INSTRUCTION'].includes(token.type)) {
			return this.parseMemoryOperand(this.parseExpression())
		}

		if (token.type === 'LPAREN') {
			this.advance()
			this.consume('DOLLAR', 'Expected $ in memory operand')
			const register = this.consume('IDENTIFIER').value
			this.consume('RPAREN', 'Expected )')
			return { type: 'memory', offset: { type: 'immediate', value: 0 }, register: '$' + register }
		}

		if (token.type === 'STRING') {
			return { type: 'string', value: this.consume('STRING').value }
		}

		return null
	}

	/**
	 * A sum of constants and at most one label, as in `4`, `-1`, `arr+4`, or
	 * `end-start`... which the single label restriction rejects, matching THRAX.
	 */
	parseExpression(): ImmediateArgument | LabelArgument {
		let label: string | null = null
		let value = 0
		let sign = 1

		// A leading sign, as in `-16`, precedes the first term.
		const leading = this.peek()
		if (leading.type === 'PLUS' || leading.type === 'MINUS') {
			sign = leading.type === 'MINUS' ? -1 : 1
			this.advance()
		}

		for (;;) {
			const token = this.peek()
			// An instruction name in operand position is a label: THRAX allows a
			// mnemonic to name one, and substitutes an identifier here.
			if (token.type === 'IDENTIFIER' || token.type === 'INSTRUCTION') {
				if (label !== null) throw new AssemblyError('Only one label is allowed per expression', at(token))
				if (sign < 0) throw new AssemblyError('A label cannot be negated', at(token))
				label = token.value
				this.advance()
			} else if (token.type === 'NUMBER') {
				value += sign * this.parseNumber(token.value, token)
				this.advance()
			} else {
				throw new AssemblyError('Expected a number or label', at(token))
			}

			const operator = this.peek()
			if (operator.type !== 'PLUS' && operator.type !== 'MINUS') break
			sign = operator.type === 'MINUS' ? -1 : 1
			this.advance()
		}

		return label === null ? { type: 'immediate', value } : { type: 'label', value: label, offset: value }
	}

	parseMemoryOperand(offset: ImmediateArgument | LabelArgument): ImmediateArgument | LabelArgument | MemoryArgument {
		if (this.peek().type !== 'LPAREN') return offset
		this.advance()
		this.consume('DOLLAR', 'Expected $ in memory operand')
		const register = this.peek().type === 'NUMBER'
			? this.consume('NUMBER').value
			: this.consume('IDENTIFIER', 'Expected register name').value
		this.consume('RPAREN', 'Expected )')
		return { type: 'memory', offset, register: '$' + register }
	}

	parseNumber(str: string, token: TokenData): number {
		if (str.startsWith('0x') || str.startsWith('0X')) {
			return parseInt(str, 16)
		}
		// A leading zero means octal, as Java's Integer.decode reads it.
		if (/^0[0-7]+$/.test(str)) {
			return parseInt(str, 8)
		}
		const value = Number(str)
		if (Number.isNaN(value)) throw new AssemblyError(`Invalid number: ${str}`, at(token))
		return value
	}

	skipNewlines() {
		while (this.peek().type === 'NEWLINE') {
			this.advance()
		}
	}

	peek(offset = 0): TokenData {
		const pos = this.pos + offset
		return pos < this.tokens.length ? this.tokens[pos] : this.tokens[this.tokens.length - 1]
	}

	advance() {
		if (!this.isAtEnd()) this.pos++
	}

	consume(type: TokenData['type'], message = ''): TokenData {
		if (this.peek().type !== type) {
			throw new AssemblyError(message || `Expected ${type}`, at(this.peek()))
		}
		const token = this.peek()
		this.advance()
		return token
	}

	isAtEnd() {
		return this.peek().type === 'EOF'
	}
}

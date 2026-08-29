/**
 * Machine-word decoding.
 *
 * This is the only place that knows the MIPS32 field layout.  The simulator
 * executes what `decode` returns, and the disassembler formats it, so a word
 * means the same thing whether it was assembled, loaded, or written by the
 * running program.
 */

/** rd, rs, rt */
const R_ARITHMETIC: Record<number, string> = {
	0x20: 'ADD', 0x21: 'ADDU', 0x22: 'SUB', 0x23: 'SUBU',
	0x24: 'AND', 0x25: 'OR', 0x26: 'XOR', 0x27: 'NOR',
	0x2a: 'SLT', 0x2b: 'SLTU',
}

/** rd, rt, shamt */
const R_SHIFT: Record<number, string> = { 0x00: 'SLL', 0x02: 'SRL', 0x03: 'SRA' }

/** rd, rt, rs */
const R_VARIABLE_SHIFT: Record<number, string> = { 0x04: 'SLLV', 0x06: 'SRLV', 0x07: 'SRAV' }

/** rs, rt */
const R_MULTIPLY: Record<number, string> = { 0x18: 'MULT', 0x19: 'MULTU', 0x1a: 'DIV', 0x1b: 'DIVU' }

/** rt, rs, sign-extended immediate */
const I_ARITHMETIC: Record<number, string> = { 0x08: 'ADDI', 0x09: 'ADDIU', 0x0a: 'SLTI', 0x0b: 'SLTIU' }

/** rt, rs, zero-extended immediate */
const I_LOGICAL: Record<number, string> = { 0x0c: 'ANDI', 0x0d: 'ORI', 0x0e: 'XORI' }

/** rt, offset(rs) */
const I_MEMORY: Record<number, string> = {
	0x20: 'LB', 0x21: 'LH', 0x23: 'LW', 0x24: 'LBU', 0x25: 'LHU',
	0x28: 'SB', 0x29: 'SH', 0x2b: 'SW',
	// Unaligned transfers, and the atomic pair THRAX treats as lw/sw.
	0x22: 'LWL', 0x26: 'LWR', 0x2a: 'SWL', 0x2e: 'SWR',
	0x30: 'LL', 0x38: 'SC',
}

/** ft, offset(rs) */
const I_FP_MEMORY: Record<number, string> = { 0x31: 'LWC1', 0x35: 'LDC1', 0x39: 'SWC1', 0x3d: 'SDC1' }

/** CP1 format field. */
const FP_FORMATS: Record<number, string> = { 16: 'S', 17: 'D', 20: 'W' }

/** fd, fs, ft */
const FP_ARITHMETIC: Record<number, string> = { 0x00: 'ADD', 0x01: 'SUB', 0x02: 'MUL', 0x03: 'DIV' }

/** fd, fs */
const FP_UNARY: Record<number, string> = { 0x04: 'SQRT', 0x05: 'ABS', 0x06: 'MOV', 0x07: 'NEG' }

/** fd, fs, with the destination format named by the mnemonic */
const FP_CONVERT: Record<number, string> = {
	0x0c: 'ROUND.W', 0x0d: 'TRUNC.W', 0x0e: 'CEIL.W', 0x0f: 'FLOOR.W',
	0x20: 'CVT.S', 0x21: 'CVT.D', 0x24: 'CVT.W',
}

/** fs, ft */
const FP_COMPARE: Record<number, string> = { 0x32: 'C.EQ', 0x3c: 'C.LT', 0x3e: 'C.LE' }

/** How a decoded instruction's operands are laid out, for formatting. */
export type OperandShape =
	| 'rd,rs,rt'
	| 'rd,rt,shamt'
	| 'rd,rt,rs'
	| 'rs,rt'
	| 'rd'
	| 'rs'
	| 'jr'
	| 'jalr'
	| 'rd,rs'
	| 'none'
	| 'rt,rs,imm'
	| 'rt,rs,uimm'
	| 'rt,uimm'
	| 'rt,offset(rs)'
	| 'ft,offset(rs)'
	| 'rs,rt,branch'
	| 'rs,branch'
	| 'branch'
	| 'jump'
	| 'break'
	| 'rt,cp0'
	| 'rt,fs'
	| 'fd,fs,ft'
	| 'fd,fs'
	| 'fs,ft'

export interface Decoded {
	/** Canonical mnemonic in the assembler's spelling, such as `ADD` or `C.LT.S`. */
	op: string
	shape: OperandShape
	rs: number
	rt: number
	rd: number
	shamt: number
	/** CP1 operands: `ft` and `fs` and `fd` occupy rt, rd, and shamt. */
	ft: number
	fs: number
	fd: number
	/** Sign-extended 16-bit immediate. */
	imm: number
	/** Zero-extended 16-bit immediate. */
	uimm: number
	/** 26-bit jump index; also the 20-bit `break` code, shifted up by six. */
	index: number
	word: number
}

/** Coprocessor 0: register moves and the exception return. */
function decodeCop0(fields: Decoded): Decoded | null {
	if (fields.word === 0x42000018) return { ...fields, op: 'ERET', shape: 'none' }
	if (fields.rs === 0) return { ...fields, op: 'MFC0', shape: 'rt,cp0' }
	if (fields.rs === 4) return { ...fields, op: 'MTC0', shape: 'rt,cp0' }
	return null
}

/** Coprocessor 1: register moves, conditional branches, and the FPU operations. */
function decodeCop1(fields: Decoded): Decoded | null {
	const { rs, rt, word } = fields
	if (rs === 0) return { ...fields, op: 'MFC1', shape: 'rt,fs', fs: fields.rd }
	if (rs === 4) return { ...fields, op: 'MTC1', shape: 'rt,fs', fs: fields.rd }
	if (rs === 8) return { ...fields, op: rt & 1 ? 'BC1T' : 'BC1F', shape: 'branch' }

	const format = FP_FORMATS[rs]
	if (!format) return null

	// A CP1 operation names ft, fs, and fd from low bits to high.
	const operands = { ...fields, ft: rt, fs: fields.rd, fd: fields.shamt }
	const func = word & 0x3f
	if (FP_ARITHMETIC[func]) return { ...operands, op: `${FP_ARITHMETIC[func]}.${format}`, shape: 'fd,fs,ft' }
	if (FP_UNARY[func]) return { ...operands, op: `${FP_UNARY[func]}.${format}`, shape: 'fd,fs' }
	if (FP_CONVERT[func]) return { ...operands, op: `${FP_CONVERT[func]}.${format}`, shape: 'fd,fs' }
	if (FP_COMPARE[func]) return { ...operands, op: `${FP_COMPARE[func]}.${format}`, shape: 'fs,ft' }
	return null
}

function decodeSpecial(fields: Decoded): Decoded | null {
	const func = fields.word & 0x3f
	const shape = (op: string, shape: OperandShape): Decoded => ({ ...fields, op, shape })

	if (func === 0x0c) return shape('SYSCALL', 'none')
	if (func === 0x0d) return shape('BREAK', 'break')
	if (R_ARITHMETIC[func]) return shape(R_ARITHMETIC[func], 'rd,rs,rt')
	if (R_SHIFT[func] !== undefined) return shape(R_SHIFT[func], 'rd,rt,shamt')
	if (R_VARIABLE_SHIFT[func]) return shape(R_VARIABLE_SHIFT[func], 'rd,rt,rs')
	if (R_MULTIPLY[func]) return shape(R_MULTIPLY[func], 'rs,rt')
	if (func === 0x10) return shape('MFHI', 'rd')
	if (func === 0x12) return shape('MFLO', 'rd')
	if (func === 0x11) return shape('MTHI', 'rs')
	if (func === 0x13) return shape('MTLO', 'rs')
	if (func === 0x08) return shape('JR', 'jr')
	if (func === 0x09) return shape('JALR', 'jalr')
	// Conditional move on an FP condition code: rt bit 0 selects true or false.
	if (func === 0x01) return shape(fields.rt & 1 ? 'MOVT' : 'MOVF', 'rd,rs')
	return null
}

/** Decodes one machine word, or returns null when it encodes no known instruction. */
export function decode(word: number): Decoded | null {
	const value = word >>> 0
	const immediate = value & 0xffff
	const fields: Decoded = {
		op: '',
		shape: 'none',
		rs: (value >>> 21) & 0x1f,
		rt: (value >>> 16) & 0x1f,
		rd: (value >>> 11) & 0x1f,
		shamt: (value >>> 6) & 0x1f,
		ft: 0,
		fs: 0,
		fd: 0,
		imm: immediate & 0x8000 ? immediate - 0x10000 : immediate,
		uimm: immediate,
		index: value & 0x3ffffff,
		word: value,
	}

	const opcode = value >>> 26
	const shape = (op: string, layout: OperandShape): Decoded => ({ ...fields, op, shape: layout })

	if (opcode === 0) return decodeSpecial(fields)
	if (opcode === 0x10) return decodeCop0(fields)
	if (opcode === 0x11) return decodeCop1(fields)
	if (I_FP_MEMORY[opcode]) return { ...fields, op: I_FP_MEMORY[opcode], shape: 'ft,offset(rs)', ft: fields.rt }
	if (opcode === 0x1c && (value & 0x3f) === 0x02) return shape('MUL', 'rd,rs,rt')

	if (I_ARITHMETIC[opcode]) return shape(I_ARITHMETIC[opcode], 'rt,rs,imm')
	if (I_LOGICAL[opcode]) return shape(I_LOGICAL[opcode], 'rt,rs,uimm')
	if (opcode === 0x0f) return shape('LUI', 'rt,uimm')
	if (I_MEMORY[opcode]) return shape(I_MEMORY[opcode], 'rt,offset(rs)')

	if (opcode === 0x04) return shape('BEQ', 'rs,rt,branch')
	if (opcode === 0x05) return shape('BNE', 'rs,rt,branch')
	if (opcode === 0x06) return shape('BLEZ', 'rs,branch')
	if (opcode === 0x07) return shape('BGTZ', 'rs,branch')
	// Opcode 1 splits on rt: 0 is bltz, 1 is bgez.
	if (opcode === 0x01) return shape(fields.rt === 1 ? 'BGEZ' : 'BLTZ', 'rs,branch')

	if (opcode === 0x02) return shape('J', 'jump')
	if (opcode === 0x03) return shape('JAL', 'jump')

	return null
}

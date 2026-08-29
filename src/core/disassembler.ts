import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from './coprocessor'
import { decode, type Decoded } from './decoder'
import { formatHex, formatWord } from './format'
import { REGISTER_NAMES } from './registers'
import type { CodeWord } from './types'

const register = (index: number) => REGISTER_NAMES[index] ?? `$${index}`

const fpRegister = (index: number) => `$f${index}`

const hex = formatWord

const hexImmediate = (value: number) => `0x${value.toString(16).toUpperCase()}`

/** Branch and jump targets resolve against the instruction's own address when known. */
const branchTarget = (address: number | undefined, offset: number) =>
	address === undefined ? `${offset}` : hex((address + 4 + offset * 4) >>> 0)

const jumpTarget = (address: number | undefined, index: number) =>
	hex(address === undefined ? index << 2 : ((address & 0xf0000000) | (index << 2)) >>> 0)

/** Renders a decoded instruction's operands in its own layout. */
function operands(decoded: Decoded, address: number | undefined): string {
	const { rs, rt, rd, shamt, ft, fs, fd, imm, uimm, index } = decoded

	switch (decoded.shape) {
		case 'rd,rs,rt': return `${register(rd)}, ${register(rs)}, ${register(rt)}`
		case 'rd,rt,shamt': return `${register(rd)}, ${register(rt)}, ${shamt}`
		case 'rd,rt,rs': return `${register(rd)}, ${register(rt)}, ${register(rs)}`
		case 'rs,rt': return `${register(rs)}, ${register(rt)}`
		case 'rd': return register(rd)
		case 'rs': return register(rs)
		case 'jr': return register(rs)
		case 'jalr': return rd === 31 ? register(rs) : `${register(rd)}, ${register(rs)}`
		case 'rd,rs': return `${register(rd)}, ${register(rs)}`
		case 'none': return ''
		// The break code occupies the 20 bits above the function field.
		case 'break': return index >>> 6 ? `${index >>> 6}` : ''
		case 'rt,rs,imm': return `${register(rt)}, ${register(rs)}, ${imm}`
		case 'rt,rs,uimm': return `${register(rt)}, ${register(rs)}, ${hexImmediate(uimm)}`
		case 'rt,uimm': return `${register(rt)}, ${hexImmediate(uimm)}`
		case 'rt,offset(rs)': return `${register(rt)}, ${imm}(${register(rs)})`
		case 'ft,offset(rs)': return `${fpRegister(ft)}, ${imm}(${register(rs)})`
		case 'rs,rt,branch': return `${register(rs)}, ${register(rt)}, ${branchTarget(address, imm)}`
		case 'rs,branch': return `${register(rs)}, ${branchTarget(address, imm)}`
		case 'branch': return branchTarget(address, imm)
		case 'jump': return jumpTarget(address, index)
		case 'rt,cp0': return `${register(rt)}, $${rd}`
		case 'rt,fs': return `${register(rt)}, ${fpRegister(fs)}`
		case 'fd,fs,ft': return `${fpRegister(fd)}, ${fpRegister(fs)}, ${fpRegister(ft)}`
		case 'fd,fs': return `${fpRegister(fd)}, ${fpRegister(fs)}`
		case 'fs,ft': return `${fpRegister(fs)}, ${fpRegister(ft)}`
	}
}

/**
 * Renders one machine word as MIPS assembly, or null when it matches no
 * instruction this assembler emits.
 */
export function disassemble(word: number, address?: number): string | null {
	if ((word >>> 0) === 0) return 'nop'

	const decoded = decode(word)
	if (!decoded) return null

	const text = operands(decoded, address)
	const mnemonic = decoded.op.toLowerCase()
	return text ? `${mnemonic} ${text}` : mnemonic
}

/** Memory holds a word little end first, which is the order the row carries. */
const dataWord = (bytes: number[]) => bytes.reduce((word, byte, index) => word | (byte << (index * 8)), 0) >>> 0

const ASCII_ESCAPES: Record<number, string> = { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r' }

const asciiText = (bytes: number[]) => bytes
	.map((byte) => ASCII_ESCAPES[byte] ?? (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : `\\x${formatHex(byte, 2)}`))
	.join('')

/**
 * A data row read back as the directive that wrote it, which is what the
 * disassembly column shows where there is no instruction to decode.  `next` is
 * the row after this one, which a double needs for its high word.
 */
export function disassembleData(row: CodeWord, next?: CodeWord): string {
	const { bytes, directive, offset = 0 } = row
	if (directive === undefined) return ''
	switch (directive) {
		case '.float':
			return `.float ${formatSingle(bitsToSingle(dataWord(bytes)))}`
		case '.double': {
			// A double spans two rows, and reads on the one it starts.
			if (offset % 8 !== 0) return ''
			const high = next?.directive === directive && next.offset === offset + 4 ? next : undefined
			return high === undefined ? '.double' : `.double ${formatDouble(bitsToDouble(dataWord(bytes), dataWord(high.bytes)))}`
		}
		case '.half':
			return `.half ${[0, 2].filter((at) => at < bytes.length).map((at) => `0x${formatHex(dataWord(bytes.slice(at, at + 2)), 4)}`).join(' ')}`
		case '.byte':
			return `.byte ${bytes.map((byte) => `0x${formatHex(byte, 2)}`).join(' ')}`
		case '.ascii':
		case '.asciiz':
			return `${directive} "${asciiText(bytes)}"`
		case '.space':
		case '.extern':
			return directive
		default:
			return `${directive} ${formatWord(dataWord(bytes))}`
	}
}

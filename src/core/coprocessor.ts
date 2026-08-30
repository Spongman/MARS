/**
 * Coprocessor support: CP0 (system control) and CP1 (floating point).
 *
 * The register files are plain arrays of raw 32-bit words so snapshots stay
 * cheap to copy; the helpers here convert between those words and JavaScript
 * numbers.
 */

export const FP_REGISTER_COUNT = 32
export const FP_CONDITION_FLAG_COUNT = 8
export const CP0_REGISTER_COUNT = 32

/** The CP0 registers exposed, in display order. */
export const CP0_REGISTERS = [
	{ index: 8, name: '$8 (vaddr)' },
	{ index: 12, name: '$12 (status)' },
	{ index: 13, name: '$13 (cause)' },
	{ index: 14, name: '$14 (epc)' },
]

const CP0_ALIASES: Record<string, number> = {
	$vaddr: 8,
	$badvaddr: 8,
	$status: 12,
	$cause: 13,
	$epc: 14,
}

/** Boots with interrupts enabled and all interrupt masks set. */
export const CP0_STATUS_INITIAL = 0x0000ff11
/** Status bit 1: the processor is already handling an exception. */
export const CP0_STATUS_EXL = 0x2

export const EXCEPTION_BREAKPOINT = 9
export const EXCEPTION_SYSCALL = 8
export const EXCEPTION_RESERVED_INSTRUCTION = 10

const scratch = new DataView(new ArrayBuffer(8))

/** `$f0`-`$f31`, or a bare `$0`-`$31` inside a coprocessor operand. */
export function fpRegisterNumber(name: string): number {
	const match = /^\$f?(\d{1,2})$/i.exec(name)
	if (!match) throw new Error(`Not a floating-point register: ${name}`)
	const index = Number(match[1])
	if (index >= FP_REGISTER_COUNT) throw new Error(`Invalid floating-point register: ${name}`)
	return index
}

/** `$0`-`$31` or one of the CP0 register aliases such as `$status`. */
export function cp0RegisterNumber(name: string): number {
	const alias = CP0_ALIASES[name.toLowerCase()]
	if (alias !== undefined) return alias
	const match = /^\$(\d{1,2})$/.exec(name)
	if (!match) throw new Error(`Not a coprocessor 0 register: ${name}`)
	const index = Number(match[1])
	if (index >= CP0_REGISTER_COUNT) throw new Error(`Invalid coprocessor 0 register: ${name}`)
	return index
}

export function singleToBits(value: number): number {
	scratch.setFloat32(0, value, true)
	return scratch.getUint32(0, true)
}

export function bitsToSingle(bits: number): number {
	scratch.setUint32(0, bits >>> 0, true)
	return scratch.getFloat32(0, true)
}

export function doubleToBits(value: number): { low: number; high: number } {
	scratch.setFloat64(0, value, true)
	return { low: scratch.getUint32(0, true), high: scratch.getUint32(4, true) }
}

export function bitsToDouble(low: number, high: number): number {
	scratch.setUint32(0, low >>> 0, true)
	scratch.setUint32(4, high >>> 0, true)
	return scratch.getFloat64(0, true)
}

/** IEEE default rounding: halfway values go to the even neighbour. */
export function roundToNearestEven(value: number): number {
	const lower = Math.floor(value)
	const fraction = value - lower
	if (fraction > 0.5) return lower + 1
	if (fraction < 0.5) return lower
	return lower % 2 === 0 ? lower : lower + 1
}

function formatSpecial(value: number): string {
	if (Number.isNaN(value)) return 'NaN'
	return value > 0 ? 'Infinity' : '-Infinity'
}

/** Shortest decimal that reads back as the same single-precision value. */
export function formatSingle(value: number): string {
	if (!Number.isFinite(value)) return formatSpecial(value)
	const target = Math.fround(value)
	for (let digits = 1; digits < 9; digits++) {
		const text = target.toPrecision(digits)
		if (Math.fround(Number(text)) === target) return Number(text).toString()
	}
	return Number(target.toPrecision(9)).toString()
}

export function formatDouble(value: number): string {
	if (!Number.isFinite(value)) return formatSpecial(value)
	return value.toString()
}

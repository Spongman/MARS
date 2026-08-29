/**
 * General-purpose register naming.
 *
 * MIPS assembly names the same register either symbolically (`$t0`) or by
 * number (`$8`), so both the assembler and the simulator resolve names here.
 */

/** Canonical names, indexed by register number. */
export const REGISTER_NAMES = [
	'$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
	'$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
	'$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
	'$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra',
]

const NUMBERS: Record<string, number> = Object.fromEntries([
	...REGISTER_NAMES.map((name, number) => [name, number]),
	...REGISTER_NAMES.map((_name, number) => [`$${number}`, number]),
])

/** The register number for `name`, or null when it names no register. */
export function registerNumber(name: string): number | null {
	const number = NUMBERS[name.toLowerCase()]
	return number === undefined ? null : number
}

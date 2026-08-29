/**
 * Hexadecimal formatting.
 *
 * One spelling of a 32-bit value everywhere it is shown, so the memory view,
 * the disassembly gutter, and the tools cannot drift apart.  The THRAX HexText
 * export is deliberately not built on this: that is a file format with its own
 * lowercase rule, not something on screen.
 */

/** `0x0040000C`: the way this workspace writes a word or an address. */
export function formatWord(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

/** `0x0040000C` without the prefix, for columns that supply their own. */
export function formatWordDigits(value: number): string {
	return (value >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

/** A half-word, byte, or other narrow field, padded to `digits`. */
export function formatHex(value: number, digits: number): string {
	return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0')
}

/**
 * The key a word occupies in a `MemoryView`.  Producer and consumers have to
 * agree exactly, so they all come through here.
 */
export function memoryKey(address: number): string {
	return formatWord(address)
}

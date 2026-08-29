/**
 * THRAX-compatible hexadecimal text export for a contiguous sequence of words.
 * Each word is represented by eight lowercase hexadecimal characters and a newline.
 */
function formatHexTextWord(word: number): string {
	if (!Number.isInteger(word) || word < -0x80000000 || word > 0xffffffff) {
		throw new RangeError(`Expected a signed or unsigned 32-bit word, received ${word}`)
	}

	return (word >>> 0).toString(16).padStart(8, '0')
}

/**
 * Produces the original THRAX HexText format: one 32-bit text-segment word per line.
 */
function createHexText(machineCode: readonly number[]): string {
	return machineCode.map(formatHexTextWord).join('\n') + (machineCode.length > 0 ? '\n' : '')
}

/**
 * Creates a plain-text Blob ready for the browser download API.
 */
function createHexTextBlob(machineCode: readonly number[]): Blob {
	return new Blob([createHexText(machineCode)], { type: 'text/plain;charset=utf-8' })
}

/**
 * Starts a browser download of assembled text-segment words in THRAX HexText format.
 */
export function downloadHexText(machineCode: readonly number[], filename = 'thrax-text.hex'): void {
	const url = URL.createObjectURL(createHexTextBlob(machineCode))
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	link.style.display = 'none'
	document.body.append(link)
	link.click()
	link.remove()
	window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

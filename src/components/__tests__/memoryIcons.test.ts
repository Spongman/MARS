import { describe, expect, it } from 'vitest'
import { asciiName, toIcon } from '../MemoryView'

describe('naming a byte that cannot be printed', () => {
	it('says what the cursor movers do', () => {
		expect(toIcon(0x0a)).toBe('↓') // LF, down
		expect(toIcon(0x0d)).toBe('↤') // CR, left to bar
		expect(toIcon(0x09)).toBe('⇥') // TAB, to bar
	})

	it('gives NUL the quietest mark, since it fills untouched memory', () => {
		expect(toIcon(0x00)).toBe('·')
	})

	it('rings a bell for BEL', () => {
		expect(toIcon(0x07)).toBe('⍾')
	})

	it('falls back to the mnemonic picture for a code with no convention', () => {
		expect(toIcon(0x01)).toBe('␁') // SOH
		expect(toIcon(0x1f)).toBe('␟') // US
	})

	it('gives the high half a placeholder box, since nothing names it', () => {
		expect(toIcon(0x80)).toBe('▯')
		expect(toIcon(0xff)).toBe('▯')
	})

	it('gives every unprintable byte exactly one character', () => {
		for (let byte = 0; byte < 256; byte++) {
			if (byte >= 0x20 && byte <= 0x7e) continue
			expect([...toIcon(byte)]).toHaveLength(1)
		}
	})
})

describe('naming a byte in the tooltip', () => {
	it('names the control codes', () => {
		expect(asciiName(0x07)).toBe('BEL')
		expect(asciiName(0x0a)).toBe('LF')
		expect(asciiName(0x0d)).toBe('CR')
		expect(asciiName(0x00)).toBe('NUL')
		expect(asciiName(0x1f)).toBe('US')
	})

	it('names the two printable bytes that are easy to misread', () => {
		expect(asciiName(0x20)).toBe('SP')
		expect(asciiName(0x7f)).toBe('DEL')
	})

	it('has no name for an ordinary character or for the high half', () => {
		expect(asciiName(0x41)).toBeNull()
		expect(asciiName(0x80)).toBeNull()
	})
})

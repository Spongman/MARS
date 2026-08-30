import { describe, expect, it } from 'vitest'
import { dimmedDigits, splitHex } from '../HexNumber'

describe('how far a leading zero run is dimmed', () => {
	it('dims nothing when it is off', () => {
		expect(dimmedDigits(6, 8, 'off')).toBe(0)
	})

	it('dims every zero digit by nibble', () => {
		expect(dimmedDigits(5, 8, 'nibbles')).toBe(5)
		expect(dimmedDigits(0, 8, 'nibbles')).toBe(0)
	})

	it('dims only whole bytes, leaving an odd digit bright', () => {
		expect(dimmedDigits(5, 8, 'bytes')).toBe(4)
		expect(dimmedDigits(1, 8, 'bytes')).toBe(0)
	})

	it('dims only whole halfwords', () => {
		expect(dimmedDigits(3, 8, 'halfwords')).toBe(0)
		expect(dimmedDigits(4, 8, 'halfwords')).toBe(4)
		expect(dimmedDigits(7, 8, 'halfwords')).toBe(4)
	})
})

describe('leaving a power-of-two number of digits standing', () => {
	// What survives is always 1, 2, 4 or 8 wide, whatever the value.
	const survivors = (leading: number, total = 8) => total - dimmedDigits(leading, total, 'pow2')

	it('leaves one digit for a single significant digit', () => {
		expect(survivors(7)).toBe(1)
	})

	it('leaves two for two', () => {
		expect(survivors(6)).toBe(2)
	})

	it('rounds three up to four', () => {
		expect(survivors(5)).toBe(4)
		expect(survivors(4)).toBe(4)
	})

	it('rounds five up to eight, so nothing is dimmed', () => {
		expect(survivors(3)).toBe(8)
		expect(survivors(0)).toBe(8)
	})

	it('works on a number that is not eight digits wide', () => {
		expect(survivors(3, 4)).toBe(1)
		expect(survivors(2, 4)).toBe(2)
		expect(survivors(1, 4)).toBe(4)
	})
})

describe('splitting a hex number', () => {
	it('keeps the prefix out of the dimmed run', () => {
		expect(splitHex('0x0040F000', 'nibbles')).toEqual({ prefix: '0x', zeros: '00', rest: '40F000' })
	})

	it('rounds the run down to the chosen unit', () => {
		expect(splitHex('0x0040F000', 'halfwords').zeros).toBe('')
		expect(splitHex('0x0040F000', 'bytes').zeros).toBe('00')
	})

	it('leaves a power-of-two run standing', () => {
		// Six significant digits round up to eight, so none are dimmed.
		expect(splitHex('0x0040F000', 'pow2').rest).toBe('0040F000')
		// One significant digit leaves one.
		expect(splitHex('0x0000000C', 'pow2')).toEqual({ prefix: '0x', zeros: '0000000', rest: 'C' })
		// Three round up to four.
		expect(splitHex('0x00000ABC', 'pow2')).toEqual({ prefix: '0x', zeros: '0000', rest: '0ABC' })
	})

	it('leaves the last digit of an all-zero value readable', () => {
		const nibbles = splitHex('0x00000000', 'nibbles')
		expect(nibbles.zeros).toBe('0000000')
		expect(nibbles.rest).toBe('0')
		expect(splitHex('0x00000000', 'pow2').rest).toBe('0')
	})

	it('works without a prefix', () => {
		expect(splitHex('00ff', 'bytes')).toEqual({ prefix: '', zeros: '00', rest: 'ff' })
	})
})

describe('the memory grid dims by the same rule as a lone number', () => {
	// The grid holds one group as several two-digit bytes and dims across the
	// boundaries, so it asks the same question with the group's own width.
	const perByte = (leading: number, total: number, mode: Parameters<typeof dimmedDigits>[2]) => {
		const dim = dimmedDigits(leading, total, mode)
		return Array.from({ length: total / 2 }, (unused, index) => Math.min(2, Math.max(0, dim - index * 2)))
	}

	it('leaves a five-digit value alone, since five rounds up to eight', () => {
		// 0x000A2021: what the grid used to dim to 'A2021' with three faint zeros.
		expect(perByte(3, 8, 'pow2')).toEqual([0, 0, 0, 0])
	})

	it('dims seven of eight digits for a single significant one', () => {
		expect(perByte(7, 8, 'pow2')).toEqual([2, 2, 2, 1])
	})

	it('still dims every zero digit under nibbles', () => {
		expect(perByte(3, 8, 'nibbles')).toEqual([2, 1, 0, 0])
	})
})

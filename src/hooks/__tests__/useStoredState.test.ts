import { beforeEach, describe, expect, it } from 'vitest'
import { isFlagSet, isOneOf, readStoredSetting, writeStoredSetting } from '../useStoredState'

const store = new Map<string, string>()

// The helpers reach for `window` when they are called, not when imported, so a
// stub is all the node environment needs.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => { store.set(key, value) },
		},
	},
	writable: true,
})

describe('stored settings', () => {
	beforeEach(() => store.clear())

	it('reads back what it wrote, under the settings prefix', () => {
		writeStoredSetting('registers.tab', 'coproc1')
		expect(store.get('thrax-web.settings.registers.tab')).toBe('"coproc1"')
		expect(readStoredSetting('registers.tab', 'registers', isOneOf(['registers', 'coproc1']))).toBe('coproc1')
	})

	it('round-trips a nested object of flags', () => {
		const formats = { 'Zero/At': { '0n': false, '0x': true, f: false, d: false } }
		const isFormats = (value: unknown) =>
			typeof value === 'object' && value !== null &&
			isFlagSet(['0n', '0x', 'f', 'd'])((value as Record<string, unknown>)['Zero/At'])
		writeStoredSetting('registers.formats', formats)
		expect(readStoredSetting('registers.formats', {}, isFormats)).toEqual(formats)
	})

	it('falls back to the default for a stored value the validator refuses', () => {
		writeStoredSetting('memory.groupSize', 3)
		expect(readStoredSetting('memory.groupSize', 4, isOneOf([1, 2, 4]))).toBe(4)
	})

	it('falls back to the default when nothing is stored or the JSON is broken', () => {
		expect(readStoredSetting('run.speed', null, () => true)).toBe(null)
		store.set('thrax-web.settings.run.speed', '{oops')
		expect(readStoredSetting('run.speed', null, () => true)).toBe(null)
	})

	it('keeps null as a stored value in its own right', () => {
		const speeds: Array<number | null> = [1, 30, null]
		writeStoredSetting('run.speed', null)
		expect(readStoredSetting<number | null>('run.speed', 1, (value) => speeds.includes(value as number | null))).toBe(null)
	})
})

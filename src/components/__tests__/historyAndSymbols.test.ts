import { describe, expect, it } from 'vitest'
import { describeEffect, rowEffects } from '../HistoryView'
import { symbolRows, symbolSections } from '../SymbolTableView'
import { parseEditedDouble, parseEditedValue } from '../editValue'
import { EffectStore } from '../../core/effectStore'
import type { Effect, HistoryEntry, SymbolTables } from '../../core/types'

describe('what a history row says about an effect', () => {
	const register: Effect = { kind: 'register', name: '$t0', value: 5 }

	it('reads the held value as the old one behind the present', () => {
		// Behind the cursor the effect holds what the instruction destroyed.
		expect(describeEffect(register, false)?.label).toBe('$t0 0x00000005 →')
	})

	it('reads it as the new one ahead of the present', () => {
		// Ahead of it, the same field holds what the instruction produced.
		expect(describeEffect(register, true)?.label).toBe('$t0 → 0x00000005')
	})

	it('names a run of memory once, with the span it covers', () => {
		const effect: Effect = { kind: 'memory', wordAddress: 0x10010000 >>> 2, words: [1, 2, 3] }
		expect(describeEffect(effect, false)).toEqual({ label: '[0x10010000+12]', address: 0x10010000 })
	})

	it('gives a single word its plain address', () => {
		const effect: Effect = { kind: 'memory', wordAddress: 0x10010004 >>> 2, words: [0] }
		expect(describeEffect(effect, false)).toEqual({ label: '[0x10010004]', address: 0x10010004 })
	})

	it('shows what a syscall read and what it printed', () => {
		expect(describeEffect({ kind: 'input', value: '42' }, false)?.label).toBe('read "42"')
		expect(describeEffect({ kind: 'console', text: 'hi' }, false)?.label).toBe('console "hi"')
	})

	it('gives a row one chip per effect, read back out of the columns', () => {
		const effects = new EffectStore()
		const start = effects.beginRun()
		effects.push('register', 8, 5)
		const { count } = effects.endRun()
		const entry: HistoryEntry = {
			id: 1,
			instructionCount: 0,
			address: 0,
			word: null,
			instruction: null,
			kind: 'instruction',
			pc: 0,
			delayState: 'none',
			delayedTarget: 0,
			effectStart: start,
			effectCount: count,
		}
		expect(rowEffects(entry, effects, false).map((chip) => chip.label)).toEqual(['$t0 0x00000005 →'])
	})
})

describe('the symbol table', () => {
	const symbols: SymbolTables = {
		globals: new Map([['helper', 0x00400010]]),
		locals: new Map([
			['b.asm', new Map([['loop', 0x00400020]])],
			['a.asm', new Map([['loop', 0x00400004], ['done', 0x00400000]])],
		]),
	}

	it('puts the globals first, then a section per file', () => {
		const sections = symbolSections(symbolRows(symbols))
		expect(sections.map((section) => section.file)).toEqual([null, 'a.asm', 'b.asm'])
		expect(sections[0].rows.map((row) => row.name)).toEqual(['helper'])
	})

	it('keeps the same name in two files as two rows', () => {
		const rows = symbolRows(symbols).filter((row) => row.name === 'loop')
		expect(rows.map((row) => row.file)).toEqual(['a.asm', 'b.asm'])
		expect(rows.map((row) => row.address)).toEqual([0x00400004, 0x00400020])
	})

	it('sorts within a file by name or by address', () => {
		const byName = symbolRows(symbols, 'name').filter((row) => row.file === 'a.asm')
		expect(byName.map((row) => row.name)).toEqual(['done', 'loop'])

		const byAddress = symbolRows(symbols, 'address').filter((row) => row.file === 'a.asm')
		expect(byAddress.map((row) => row.name)).toEqual(['done', 'loop'])
	})
})

describe('reading a value typed into a cell', () => {
	it('reads the radix the cell is showing', () => {
		expect(parseEditedValue('20', '0n')).toBe(20)
		expect(parseEditedValue('20', '0x')).toBe(0x20)
	})

	it('takes a 0x prefix wherever it appears', () => {
		expect(parseEditedValue('0x1f', '0n')).toBe(31)
		expect(parseEditedValue('0x1f', '0x')).toBe(31)
	})

	it('keeps a negative value as the word that holds it', () => {
		expect(parseEditedValue('-1', '0n')).toBe(0xffffffff)
	})

	it('refuses text that is not a value in that radix', () => {
		expect(parseEditedValue('', '0n')).toBeNull()
		expect(parseEditedValue('  ', '0x')).toBeNull()
		expect(parseEditedValue('12g', '0x')).toBeNull()
		expect(parseEditedValue('1f', '0n')).toBeNull()
	})

	it('turns a float into the bits the machine stores', () => {
		expect(parseEditedValue('1', 'f')).toBe(0x3f800000)
		expect(parseEditedDouble('1')).toEqual({ low: 0, high: 0x3ff00000 })
		expect(parseEditedDouble('nonsense')).toBeNull()
	})
})

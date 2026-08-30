import { describe, expect, it } from 'vitest'
import type { Effect, HistoryEntry } from '../types'

describe('the history entry shape', () => {
	it('covers every kind of change an instruction can make', () => {
		const effects: Effect[] = [
			{ kind: 'register', name: '$t0', value: 0 },
			{ kind: 'fp', index: 0, value: 0 },
			{ kind: 'flag', index: 0, value: false },
			{ kind: 'cp0', index: 12, value: 0 },
			{ kind: 'memory', wordAddress: 0x04004000, words: [undefined, 7] },
			{ kind: 'console', text: 'hi' },
			{ kind: 'consoleReset', value: 'hi' },
			{ kind: 'display', value: '' },
			{ kind: 'queuedInput', value: 'ab' },
			{ kind: 'call', frame: { callAddress: 0, returnAddress: 4, targetAddress: 8 } },
			{ kind: 'hiLo', hi: 0, lo: 0 },
			{ kind: 'heapPointer', value: 0x10040000 },
			{ kind: 'halted', value: false },
			{ kind: 'exitCode', value: null },
			{ kind: 'sleep', value: 0 },
			{ kind: 'input', value: '42' },
		]

		// A memory effect covers a run of words, so one buffer write is one row.
		const memory = effects.find((effect) => effect.kind === 'memory')!
		expect(memory).toMatchObject({ words: [undefined, 7] })
	})

	it('carries the subsystem copies only when an instruction took one', () => {
		const entry: HistoryEntry = {
			id: 1,
			instructionCount: 0,
			address: 0x00400000,
			word: 0x21080005,
			instruction: null,
			kind: 'instruction',
			pc: 0x00400000,
			delayState: 'none',
			delayedTarget: 0,
			effectStart: 0,
			effectCount: 0,
		}

		expect(entry.files).toBeUndefined()
		expect(entry.random).toBeUndefined()
	})
})

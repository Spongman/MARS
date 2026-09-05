import { describe, expect, it } from 'vitest'
import { moveToEntry } from '../historyLog'

/**
 * Where the machine has to go to stand at one entry of the log.  The cursor
 * sits *on* the entry, whose instruction is the next to run, so both directions
 * have to land on the same place.
 */

describe('putting the machine at an entry', () => {
	it('lands on the entry itself, whichever direction it comes from', () => {
		expect(moveToEntry(10, 4)).toEqual({ rewind: true, steps: 0 })
		expect(moveToEntry(4, 10)).toEqual({ rewind: false, steps: 6 })
	})

	it('does nothing when the machine is already there', () => {
		// Running forward used to stop one past the entry, so a second click
		// rewound onto it again and the arrow flicked between two lines.
		expect(moveToEntry(7, 7)).toEqual({ rewind: false, steps: 0 })
	})

	it('is idempotent: arriving and clicking again does not move', () => {
		const first = moveToEntry(2, 9)
		const settled = first.rewind ? 9 : 2 + first.steps
		expect(settled).toBe(9)
		expect(moveToEntry(settled, 9)).toEqual({ rewind: false, steps: 0 })
	})
})

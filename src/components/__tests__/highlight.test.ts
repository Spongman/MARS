import { describe, expect, it } from 'vitest'
import { flashClass, movedEntries, withAlpha } from '../highlight'

describe('which values a change flash lights', () => {
	const before = new Map([['$t0', 1], ['$t1', 2]])

	it('lights nothing on the first look at a panel', () => {
		// Arriving at a panel is not a change to what it shows: without this every
		// value would flash the moment the panel opened.
		expect([...movedEntries(null, before)]).toEqual([])
	})

	it('lights only what moved', () => {
		expect([...movedEntries(before, new Map([['$t0', 9], ['$t1', 2]]))]).toEqual(['$t0'])
	})

	it('lights nothing when a step wrote the value that was already there', () => {
		expect([...movedEntries(before, before)]).toEqual([])
	})

	it('leaves a name that was not there before alone', () => {
		// A row scrolling into view, or a tab that shows a different file of
		// values, has not changed anything.
		expect([...movedEntries(before, new Map([['$t0', 1], ['$s0', 7]]))]).toEqual([])
	})
})

describe('the two highlights', () => {
	it('keeps them apart, since they answer different questions', () => {
		expect(flashClass('navigation')).not.toBe(flashClass('change'))
	})

	it('takes an alpha from the chosen colour, which a colour input cannot carry', () => {
		expect(withAlpha('#4094ff', 0.55)).toBe('rgba(64, 148, 255, 0.55)')
		// Anything that is not a plain six-digit colour is left as it stands
		// rather than turned into a colour the stylesheet cannot read.
		expect(withAlpha('nonsense', 0.55)).toBe('nonsense')
	})
})

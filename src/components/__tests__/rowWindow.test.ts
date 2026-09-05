import { describe, expect, it } from 'vitest'
import { rowFrame, rowTop, rowWindow } from '../rowWindow'

/**
 * The memory window and the history both draw a band of a much longer list.
 * What matters is that the band covers the viewport, that it is the same size
 * wherever it sits, and that the two ends of the list behave.
 */

const ROW = 20
const OVERSCAN = 4

describe('the band of rows a scroller draws', () => {
	it('covers the viewport, with overscan past each edge', () => {
		// 200px of viewport is ten rows, plus four drawn above and four below.
		expect(rowWindow(400, 200, ROW, 1000, OVERSCAN)).toEqual({ first: 16, count: 18 })
	})

	it('is the same size wherever it sits, so rows can be pooled', () => {
		const sizes = [0, 100, 5000, 19640].map((top) => rowWindow(top, 200, ROW, 1000, OVERSCAN).count)
		expect(new Set(sizes).size).toBe(1)
	})

	it('draws a full screen at the bottom rather than a few rows against it', () => {
		// Scrolled to the very end: the band is pulled back to leave its whole
		// count behind it, instead of running off the end of the list.
		const { first, count } = rowWindow(1000 * ROW, 200, ROW, 1000, OVERSCAN)
		expect(first + count).toBe(1000)
		expect(count).toBe(18)
	})

	it('starts at the top rather than before it', () => {
		expect(rowWindow(0, 200, ROW, 1000, OVERSCAN).first).toBe(0)
	})

	it('draws no more rows than there are', () => {
		expect(rowWindow(0, 200, ROW, 3, OVERSCAN)).toEqual({ first: 0, count: 3 })
	})

	it('draws nothing for an empty list', () => {
		expect(rowWindow(0, 200, ROW, 0, OVERSCAN)).toEqual({ first: 0, count: 0 })
	})

	it('draws only overscan until the scroller has been measured', () => {
		// A panel mounted into a hidden tab has no height yet.  Something is drawn
		// so the first paint is not blank, and the observer corrects it.
		expect(rowWindow(0, 0, ROW, 1000, OVERSCAN)).toEqual({ first: 0, count: 8 })
	})
})

describe('where a fixed row is pinned', () => {
	// A scroller 40px down the page, with a 1px border, and a probe reporting
	// that fixed positioning resolves from the page rather than an ancestor.
	const grid = { top: 40, left: 12, clientTop: 1, clientLeft: 1, clientWidth: 300 }

	it('places row zero inside the scroller, past its border', () => {
		expect(rowFrame(grid, { top: 0, left: 0 })).toEqual({ top: 41, left: 13, width: 300 })
	})

	it('is measured against the probe, not the page', () => {
		// An ancestor with a transform, filter or clip-path takes the role of
		// containing block from the viewport; the probe is what reports which one
		// won, so the offset is relative to it.
		expect(rowFrame(grid, { top: 30, left: 4 })).toEqual({ top: 11, left: 9, width: 300 })
	})

	it('moves a row up by exactly what the scroller has scrolled', () => {
		const frame = rowFrame(grid, { top: 0, left: 0 })
		expect(rowTop(frame, 0, ROW, 0)).toBe(41)
		expect(rowTop(frame, 5, ROW, 0)).toBe(141)
		// Scrolled by five rows, row five is back where row zero was.
		expect(rowTop(frame, 5, ROW, 5 * ROW)).toBe(41)
	})
})

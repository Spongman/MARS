import { describe, expect, it } from 'vitest'
import { gutterParts, hoveredColumn, tipParagraphs, tipRuns } from '../SourcePane'

/** What the gutter was before the disassembly was split into its own span. */
const asOneString = (lead: string, columns: string[]) => lead + columns.filter((column) => column.length > 0).join('  ') + '  '

describe('the gutter, split into parts', () => {
	const lead = '  '
	const code = '0x01094021'
	const asm = 'addu $t0, $t0, $t1'

	it('reads as the one string it was, whichever columns are on', () => {
		for (const [codeColumn, asmColumn] of [[code, asm], [code, ''], ['', asm], ['', '']]) {
			const parts = gutterParts(lead, codeColumn, asmColumn)
			expect(parts.pre + parts.asm + parts.tail).toBe(asOneString(lead, [codeColumn, asmColumn]))
		}
	})

	it('hands the disassembly over whole, so the padding it is aligned with comes with it', () => {
		expect(gutterParts(lead, code, `${asm}   `).asm).toBe(`${asm}   `)
	})
})

describe('which character the pointer is on', () => {
	// Ten characters over a hundred pixels: one character every ten.
	const rect = { left: 50, width: 100 }

	it('divides the span by the characters it drew', () => {
		expect(hoveredColumn(50, rect, 10)).toBe(0)
		expect(hoveredColumn(105, rect, 10)).toBe(5)
		expect(hoveredColumn(149, rect, 10)).toBe(9)
	})

	it('clamps a pointer past either end into the text', () => {
		expect(hoveredColumn(0, rect, 10)).toBe(0)
		expect(hoveredColumn(1000, rect, 10)).toBe(9)
	})

	it('answers for a span with nothing in it rather than dividing by zero', () => {
		expect(hoveredColumn(60, rect, 0)).toBe(0)
		expect(hoveredColumn(60, { left: 50, width: 0 }, 10)).toBe(0)
	})
})

describe('a data tip, drawn the way Monaco draws the one in the source', () => {
	it('gives every paragraph its own, and keeps blank ones out', () => {
		expect(tipParagraphs(['**$t0**\n\n`0x00000010`', '', '  base  '])).toEqual(['**$t0**', '`0x00000010`', 'base'])
	})

	it('splits the emphasis and the code spans out, so they can be drawn as Monaco renders them', () => {
		expect(tipRuns('**$t0**')).toEqual([{ text: '$t0', kind: 'strong' }])
		expect(tipRuns('`0x00000010 (16, unsigned 16)`')).toEqual([{ text: '0x00000010 (16, unsigned 16)', kind: 'code' }])
	})

	it('keeps the text between the marks, and its spaces', () => {
		expect(tipRuns('base `$t0` 0 + offset 4')).toEqual([
			{ text: 'base ', kind: 'plain' },
			{ text: '$t0', kind: 'code' },
			{ text: ' 0 + offset 4', kind: 'plain' },
		])
	})

	it('leaves a paragraph with no marks in one piece', () => {
		expect(tipRuns('Effective address')).toEqual([{ text: 'Effective address', kind: 'plain' }])
	})

	it('reads a lone asterisk or backtick as the text it is', () => {
		expect(tipRuns('2 * 3').map((run) => run.text).join('')).toBe('2 * 3')
		expect(tipRuns('a `b').map((run) => run.text).join('')).toBe('a `b')
	})
})

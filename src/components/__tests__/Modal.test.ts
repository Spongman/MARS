import { describe, expect, it } from 'vitest'
import { modalKeyAction } from '../Modal'

const key = (name: string, shiftKey = false) => ({ key: name, shiftKey })
const inside = { first: false, last: false }

describe('modal keys', () => {
	it('closes on Escape wherever focus is', () => {
		expect(modalKeyAction(key('Escape'), inside)).toBe('close')
		expect(modalKeyAction(key('Escape'), { first: true, last: true })).toBe('close')
	})

	it('leaves every other key alone', () => {
		expect(modalKeyAction(key('Enter'), inside)).toBe(null)
		expect(modalKeyAction(key('a'), { first: true, last: true })).toBe(null)
	})

	it('wraps Tab around the ends and lets it through between them', () => {
		expect(modalKeyAction(key('Tab'), { first: false, last: true })).toBe('wrap-first')
		expect(modalKeyAction(key('Tab', true), { first: true, last: false })).toBe('wrap-last')
		expect(modalKeyAction(key('Tab'), inside)).toBe(null)
		expect(modalKeyAction(key('Tab', true), inside)).toBe(null)
	})
})

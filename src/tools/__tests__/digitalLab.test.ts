import { describe, expect, it } from 'vitest'
import {
	COUNTER_OFFSET,
	COUNTER_PERIOD,
	DISPLAY_LEFT_OFFSET,
	DISPLAY_RIGHT_OFFSET,
	DigitalLabSim,
	KEYPAD_OUT_OFFSET,
	KEYPAD_ROW_OFFSET,
	KEYPAD_INTERRUPT,
	TIMER_INTERRUPT,
	keyInRow,
	keypadCode,
} from '../digitalLab'

const BASE = 0xffff0000

function build() {
	const written = new Map<number, number>()
	const device = new DigitalLabSim()
	device.onConfigure({
		delayedBranching: false,
		device: {
			read: (address) => written.get(address) ?? 0,
			write: (address, value) => { written.set(address, value) },
		},
	})
	const write = (offset: number, value: number) => device.onMemoryWrite(BASE + offset, 1, value)
	return { device, written, write, answer: () => written.get(BASE + KEYPAD_OUT_OFFSET) ?? 0 }
}

describe('the keypad encoding', () => {
	it('reads a key back as its row and column, as the exercises document', () => {
		// Key 2 sits in column 3 of row 1, which the help text says is 0x41.
		expect(keypadCode(2)).toBe(0x41)
		expect(keypadCode(0)).toBe(0x11)
		expect(keypadCode(15)).toBe(0x88)
	})

	it('places each key in the row a scan of that row finds', () => {
		expect(keyInRow(2, 0x1)).toBe(true)
		expect(keyInRow(2, 0x2)).toBe(false)
		expect(keyInRow(7, 0x2)).toBe(true)
	})
})

describe('the seven-segment displays', () => {
	it('lights the segments the program writes, right and left apart', () => {
		const { device, write } = build()
		write(DISPLAY_RIGHT_OFFSET, 0x3f)
		write(DISPLAY_LEFT_OFFSET, 0x06)
		expect(device.snapshot().displays).toEqual([0x3f, 0x06])
	})
})

describe('scanning the keypad', () => {
	it('answers with the key only while its own row is selected', () => {
		const { device, write, answer } = build()
		device.pressKey(2)

		write(KEYPAD_ROW_OFFSET, 0x2)
		expect(answer()).toBe(0)

		write(KEYPAD_ROW_OFFSET, 0x1)
		expect(answer()).toBe(0x41)
	})

	it('answers with nothing once the key is released', () => {
		const { device, write, answer } = build()
		write(KEYPAD_ROW_OFFSET, 0x1)
		device.pressKey(2)
		expect(answer()).toBe(0x41)

		device.pressKey(null)
		expect(answer()).toBe(0)
	})

	it('raises an interrupt only when the high nibble enabled it', () => {
		const { device, write } = build()
		write(KEYPAD_ROW_OFFSET, 0x01)
		device.pressKey(2)
		expect(device.pendingInterrupt).toBeNull()

		write(KEYPAD_ROW_OFFSET, 0x81)
		device.pressKey(3)
		expect(device.pendingInterrupt).toBe(KEYPAD_INTERRUPT)
		expect(device.snapshot().keypadInterrupts).toBe(1)
	})
})

describe('the counter', () => {
	it('stays quiet until the program enables it', () => {
		const { device } = build()
		for (let index = 0; index < COUNTER_PERIOD * 2; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)
	})

	it('raises a timer interrupt every period once enabled', () => {
		const { device, write } = build()
		write(COUNTER_OFFSET, 1)

		for (let index = 0; index < COUNTER_PERIOD; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)

		device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(1)
		expect(device.pendingInterrupt).toBe(TIMER_INTERRUPT)
	})

	it('is turned off again by a zero', () => {
		const { device, write } = build()
		write(COUNTER_OFFSET, 1)
		write(COUNTER_OFFSET, 0)
		for (let index = 0; index < COUNTER_PERIOD * 2; index++) device.onInstruction()
		expect(device.snapshot().timerInterrupts).toBe(0)
	})
})

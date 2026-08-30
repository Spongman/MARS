/**
 * Digital Lab Simulator.
 *
 * A memory-mapped device with three parts, each a byte in the memory-mapped
 * region: two seven-segment displays a program lights segment by segment, a
 * hexadecimal keypad it scans a row at a time, and a counter that raises a
 * timer interrupt every so many instructions.
 *
 * It reads what the program wrote and writes what the program will read, so it
 * needs the device port rather than the observer interface alone.
 */

import type { DevicePort, ExecutionObserver, MachineConfig } from '../core/observer'

/** Offsets from the memory-mapped region's base, as the exercises use them. */
export const DISPLAY_RIGHT_OFFSET = 0x10
export const DISPLAY_LEFT_OFFSET = 0x11
export const KEYPAD_ROW_OFFSET = 0x12
export const COUNTER_OFFSET = 0x13
export const KEYPAD_OUT_OFFSET = 0x14

/**
 * Cause codes the two interrupts raise.  Shifted two places into the cause
 * register they land on bits 10 and 11, past the bits the keyboard and display
 * claim, so a handler can tell all four apart.
 */
export const TIMER_INTERRUPT = 0x00000100
export const KEYPAD_INTERRUPT = 0x00000200

/** Instructions between timer interrupts, as MARS counts them. */
export const COUNTER_PERIOD = 30

/** The seven segments and the point, by the bit that lights each. */
export const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'point'] as const

export interface DigitalLabState {
	/** Segment bits of the right and left displays. */
	displays: [number, number]
	/** The row the program last selected, and whether it enabled the interrupt. */
	keypadRow: number
	keypadInterruptEnabled: boolean
	/** Which key is held, 0-15, or null. */
	pressedKey: number | null
	/** What the program reads back: row and column of the key, or 0. */
	keypadOut: number
	counterEnabled: boolean
	counterRemaining: number
	/** Interrupts raised so far, which is what a program under test counts. */
	timerInterrupts: number
	keypadInterrupts: number
}

/**
 * What the program reads back for a held key: the row it is in, and the column
 * shifted into the high nibble.  Key 2 sits in column 3 of row 1 and so reads
 * back as 0x41.
 */
export function keypadCode(key: number): number {
	return (1 << Math.floor(key / 4)) | (1 << (4 + (key % 4)))
}

/** Whether the row the program selected is the one the held key is in. */
export function keyInRow(key: number, row: number): boolean {
	return (1 << Math.floor(key / 4)) === (row & 0xf)
}

export class DigitalLabSim implements ExecutionObserver {
	private port: DevicePort | null = null
	private base = 0xffff0000
	private state: DigitalLabState = freshState()
	/**
	 * The last cause the machine accepted, which is what a panel shows.  The
	 * interrupt itself is the machine's, not the tool's: this is a record of it.
	 */
	lastInterrupt: number | null = null

	onConfigure(machine: MachineConfig & { memoryMapBase?: number }) {
		this.port = machine.device ?? null
		if (machine.memoryMapBase !== undefined) this.base = machine.memoryMapBase
	}

	onReset() {
		this.state = freshState()
		this.lastInterrupt = null
	}

	/** The program writing one of the device's bytes is how it drives the device. */
	onMemoryWrite(address: number, _size: number, value: number) {
		const offset = (address >>> 0) - this.base
		const byte = value & 0xff
		switch (offset) {
			case DISPLAY_RIGHT_OFFSET: this.state.displays[0] = byte; return
			case DISPLAY_LEFT_OFFSET: this.state.displays[1] = byte; return
			case KEYPAD_ROW_OFFSET: this.scanRow(byte); return
			case COUNTER_OFFSET: this.setCounter(byte); return
		}
	}

	/** The counter runs on instructions, which is the clock MARS gives it. */
	onInstruction() {
		if (!this.state.counterEnabled) return
		if (this.state.counterRemaining > 0) {
			this.state.counterRemaining -= 1
			return
		}
		this.state.counterRemaining = COUNTER_PERIOD
		this.raise(TIMER_INTERRUPT, 'timerInterrupts')
	}

	/**
	 * Selects a keypad row.  The high nibble enables the interrupt, and the
	 * answer goes where the program reads it.
	 */
	private scanRow(row: number) {
		this.state.keypadRow = row
		this.state.keypadInterruptEnabled = (row & 0xf0) !== 0
		this.publishKeypad()
	}

	private setCounter(value: number) {
		const enabled = value !== 0
		if (enabled && !this.state.counterEnabled) this.state.counterRemaining = COUNTER_PERIOD
		this.state.counterEnabled = enabled
	}

	/** A key is held until it is released, so a scan of its row finds it. */
	pressKey(key: number | null) {
		this.state.pressedKey = key
		this.publishKeypad()
		if (key !== null && this.state.keypadInterruptEnabled) this.raise(KEYPAD_INTERRUPT, 'keypadInterrupts')
	}

	/**
	 * Hands a cause to the machine, which takes it in place of its next
	 * instruction.  Counted only when it is accepted: one the machine refused
	 * because it is already in a handler never reaches the program.
	 */
	private raise(cause: number, counter: 'timerInterrupts' | 'keypadInterrupts') {
		if (this.port?.interrupt(cause) !== true) return
		this.state[counter] += 1
		this.lastInterrupt = cause
	}

	private publishKeypad() {
		const { pressedKey, keypadRow } = this.state
		const answer = pressedKey !== null && keyInRow(pressedKey, keypadRow) ? keypadCode(pressedKey) : 0
		this.state.keypadOut = answer
		this.port?.write(this.base + KEYPAD_OUT_OFFSET, answer)
	}

	snapshot(): DigitalLabState {
		return { ...this.state, displays: [...this.state.displays] }
	}
}

function freshState(): DigitalLabState {
	return {
		displays: [0, 0],
		keypadRow: 0,
		keypadInterruptEnabled: false,
		pressedKey: null,
		keypadOut: 0,
		counterEnabled: false,
		counterRemaining: COUNTER_PERIOD,
		timerInterrupts: 0,
		keypadInterrupts: 0,
	}
}

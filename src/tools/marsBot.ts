/**
 * Mars Bot: an MMIO-driven robot that leaves a trail as it moves.
 *
 * Five memory-mapped registers starting at 0xffff8000
 * (`Globals.memory.addObserver(this, 0xffff8000, 0xffff8060)`, :263):
 *
 *   0xffff8010  heading      degrees, 0 = north (up), clockwise (:17, :286-290)
 *   0xffff8020  leave track  0/1, edge-triggered start/end of a trail segment (:18, :292-328)
 *   0xffff8030  where-are-we-X  bot writes its X back here (:19, :112) - ignored on read (:336-343)
 *   0xffff8040  where-are-we-Y  bot writes its Y back here (:20, :113) - ignored on read (:336-343)
 *   0xffff8050  move         0 = stopped, nonzero = moving (:21, :329-334)
 *
 * MOVEMENT CLOCK. MARS moves the bot on its own thread, sleeping 40ms between
 * ticks (:145-152) - a wall-clock cadence with no THRAX equivalent; the
 * observer seam only fires on simulated events. Two candidates: tick on every
 * memory write (arbitrary - a bot left "moving" through an unrelated stretch
 * of stack traffic would drift only when the program happens to touch memory,
 * and would sit still through a register-only delay loop) or tick on every
 * `onInstruction` while MOVE is on (chosen here). The latter reproduces the
 * one property that matters observably - continuous movement, decoupled from
 * what kind of work the program is doing - using "one instruction" as the unit
 * of time instead of "40ms". The cost: speed is coupled to instruction count,
 * not wall time. MARS's own bot advances one step per fixed 40ms regardless of
 * the MIPS program; this port advances one step per *instruction*, so a delay
 * loop of a different length between toggling MOVE off changes the apparent
 * speed and track length, where real MARS would not. There is no host-neutral
 * way around this without a wall-clock or a cycle-accurate timing model, and
 * neither exists in THRAX.
 *
 * H2b (onRewind) HONESTY NOTE. T1's counters invert by decrementing - order
 * does not matter to a plain count. MarsBot's track is order-sensitive twice
 * over: position is a running vector sum (heading at each tick, not just a
 * count, determines where a later step lands), and the track array's write
 * index advances only on leave-track edges, so "undo the last N ticks" is not
 * a closed-form inverse the way a counter's is. But the whole accumulator's
 * state is a handful of numbers plus a short segment list - small enough that
 * the practical answer isn't event-inversion at all, it's checkpointing: keep
 * one full snapshot of {heading, moving, leavingTrack, x, y, trackIndex,
 * track} per instruction (or per state-changing write), tagged with the
 * instruction count, bounded the same way the machine's own history already
 * is by backstepLimit; `onRewind(toInstructionCount)` finds the last
 * checkpoint at or before that count and restores it wholesale, discarding
 * later ones. Harder than a counter (nothing to simply subtract), easier than
 * a cache's LRU order (nothing to replay - just copy the struct back).
 */

import type { Decoded } from '../core/decoder'
import type { ExecutionObserver } from '../core/observer'

const ADDR_HEADING = 0xffff8010
const ADDR_LEAVE_TRACK = 0xffff8020
const ADDR_WHERE_X = 0xffff8030
const ADDR_WHERE_Y = 0xffff8040
const ADDR_MOVE = 0xffff8050

export interface Point {
	x: number
	y: number
}

export interface TrackSegment {
	from: Point
	to: Point
}

export interface MarsBotSnapshot {
	heading: number
	x: number
	y: number
	moving: boolean
	leavingTrack: boolean
	/** Completed and in-progress trail segments, in the order they were drawn. */
	segments: TrackSegment[]
}

export class MarsBot implements ExecutionObserver {
	private heading = 0
	private leavingTrack = false
	private moving = false
	private x = 0
	private y = 0
	/** arrayOfTrack/trackIndex, grown as needed rather than fixed at 256. */
	private track: Point[] = []
	private trackIndex = 0

	reset() {
		this.heading = 0
		this.leavingTrack = false
		this.moving = false
		this.x = 0
		this.y = 0
		this.track = []
		this.trackIndex = 0
	}

	onReset() {
		this.reset()
	}

	/**
	 * One MMIO write. `value` is optional only because the current observer
	 * seam cannot supply it (see the header) - a write with no value is a
	 * documented no-op, not a guess.
	 */
	onMemoryWrite(address: number, _size: number, value: number) {
		switch (address >>> 0) {
			case ADDR_HEADING:
				this.heading = value
				break
			case ADDR_LEAVE_TRACK:
				this.setLeavingTrack(value !== 0)
				break
			case ADDR_MOVE:
				this.moving = value !== 0
				break
			// ADDR_WHERE_X/Y and anything else in the bot's range: ignored,
			// matching fall-through and its explicit
			// "these writes originated within this tool" comment at :339-341.
		}
	}

	/**
	 * MARS's timer tick (see header); this stands in for it. Any executed
	 * instruction counts, matching the free-running, work-independent nature
	 * of the real thread.
	 */
	onInstruction(_address: number, _decoded: Decoded) {
		if (!this.moving) return
		this.advance()
	}

	/**: one unit step in the current heading's direction. */
	private advance() {
		const mathAngle = ((360 - this.heading) + 90) % 360
		const radians = (mathAngle * Math.PI) / 180
		this.x += Math.cos(radians)
		this.y -= Math.sin(radians) // MARS negates because screen Y grows downward.
		//: overwritten every tick regardless of leavingTrack -
		// while not leaving a track this just keeps a fresh "current point" on
		// hand for whenever leaving track starts; while leaving one, this is
		// what makes the in-progress segment's end grow live.
		this.track[this.trackIndex] = { x: this.x, y: this.y }
	}

	/** four-way branch, collapsed to the two edges that act. */
	private setLeavingTrack(want: boolean) {
		if (want === this.leavingTrack) return
		this.leavingTrack = want
		this.track[this.trackIndex] = { x: this.x, y: this.y }
		this.trackIndex += 1
	}

	snapshot(): MarsBotSnapshot {
		const segments: TrackSegment[] = []
		// draws pairs (i-1,i) for i=1,3,5,...<=trackIndex; an
		// odd trackIndex still draws its last, in-progress pair (see advance()).
		for (let i = 1; i <= this.trackIndex; i += 2) {
			const from = this.track[i - 1]
			const to = this.track[i]
			if (from && to) segments.push({ from, to })
		}
		return {
			heading: this.heading,
			x: this.x,
			y: this.y,
			moving: this.moving,
			leavingTrack: this.leavingTrack,
			segments,
		}
	}
}

export const MARS_BOT_ADDRESSES = {
	heading: ADDR_HEADING,
	leaveTrack: ADDR_LEAVE_TRACK,
	whereX: ADDR_WHERE_X,
	whereY: ADDR_WHERE_Y,
	move: ADDR_MOVE,
} as const

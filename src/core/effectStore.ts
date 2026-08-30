/**
 * Where the history's effects live.
 *
 * An effect is three small numbers and, for a few kinds, one value that is not
 * a number. Held as an object each, that costs about 56 bytes plus a slot in an
 * array of its own; held in columns it costs nine, which is what decides how
 * deep a history the workspace can afford.
 *
 * The columns come in blocks of a fixed size rather than one growing array. An
 * effect is addressed by a packed index -- the block it is in, and the slot
 * within it -- so a block whose effects have all been evicted is simply
 * dropped. Nothing is copied on eviction and nothing wraps.
 *
 * One instruction's effects never span two blocks. That way an entry's run is
 * always whole in one block, so evicting a block cannot cut an entry in half,
 * and reading a run resolves the block once. A block that fills mid-instruction
 * hands its part-built run to the next one, which is the only copy that ever
 * happens and touches only the handful of effects that instruction has so far.
 */

import { REGISTER_FILE_NAMES } from './registers'
import type { CallFrame, DelayState, Effect } from './types'

/**
 * Entries per block, and effects per block: the whole history rolls at one
 * granularity.  Profiled from 256 to 16384 against a full million-entry log,
 * memory varies by about four per cent across that range and the speed of a run
 * not at all, so this is a middle value rather than a tuned one.
 */
export const BLOCK_SIZE = 2048

/**
 * Effect kinds, as the codes the `kind` column holds.  The names are the
 * `Effect` union's, so a materialized effect reads the same either way.
 */
export const EFFECT_KINDS = [
	'register', 'fp', 'flag', 'cp0', 'memory', 'console', 'consoleReset',
	'display', 'queuedInput', 'call', 'hiLo', 'heapPointer', 'halted',
	'exitCode', 'sleep', 'input',
] as const

export type EffectKind = (typeof EFFECT_KINDS)[number]

const CODES = new Map<EffectKind, number>(EFFECT_KINDS.map((kind, code) => [kind, code]))

/** One block of columns, plus the values of the few effects that need one. */
interface Block {
	kind: Uint8Array
	/** Which location: a register number, an index, or a word address. */
	a: Int32Array
	/** The value held, or the second half of a pair. */
	b: Int32Array
	/** Only for the kinds whose value is not a number; sparse. */
	values: Map<number, unknown>
}

function emptyBlock(): Block {
	return {
		kind: new Uint8Array(BLOCK_SIZE),
		a: new Int32Array(BLOCK_SIZE),
		b: new Int32Array(BLOCK_SIZE),
		values: new Map(),
	}
}

export class EffectStore {
	/** Blocks in order; `blocks[0]` is block number `firstBlock`. */
	private blocks: Block[] = []
	private firstBlock = 0
	/** The block being written, and the next free slot in it. */
	private currentBlock = 0
	private nextSlot = 0
	/** Where the run being built started, or -1 when none is open. */
	private runStart = -1

	/** The index of the next effect, which is where a run about to open begins. */
	get position(): number {
		return this.currentBlock * BLOCK_SIZE + this.nextSlot
	}

	/**
	 * Starts an instruction's run.  A block with no room left is left behind
	 * here rather than part-way through, so a run is never split.
	 */
	beginRun(): number {
		if (this.nextSlot >= BLOCK_SIZE) this.advanceBlock()
		this.runStart = this.position
		return this.runStart
	}

	/** Ends it, giving back what the entry needs to find its effects again. */
	endRun(): { start: number, count: number } {
		const start = this.runStart < 0 ? this.position : this.runStart
		const count = this.position - start
		this.runStart = -1
		return { start, count }
	}

	push(kind: EffectKind, a: number, b: number, value?: unknown) {
		if (this.nextSlot >= BLOCK_SIZE) this.carryRunToNextBlock()
		const target = this.blockAt(this.currentBlock, true)!
		const slot = this.nextSlot++
		target.kind[slot] = CODES.get(kind)!
		target.a[slot] = a
		target.b[slot] = b
		if (value !== undefined) target.values.set(slot, value)
	}

	/**
	 * Forgets everything below `index`.  Only whole blocks are given up, since
	 * an entry's run is whole in one and the store cannot know which entries the
	 * caller still wants inside the block it is reading.
	 */
	dropBefore(index: number) {
		const wanted = Math.floor(index / BLOCK_SIZE)
		while (this.firstBlock < wanted && this.blocks.length > 1) {
			this.blocks.shift()
			this.firstBlock += 1
		}
	}

	/** Forgets everything from `index` on, which a diverging run has left behind. */
	truncate(index: number) {
		if (index >= this.position) return
		const wantedBlock = Math.max(this.firstBlock, Math.floor(index / BLOCK_SIZE))
		this.currentBlock = wantedBlock
		this.nextSlot = index < wantedBlock * BLOCK_SIZE ? 0 : index % BLOCK_SIZE
		while (this.firstBlock + this.blocks.length - 1 > this.currentBlock) this.blocks.pop()
		const block = this.blockAt(this.currentBlock)
		// The values of the effects being dropped go with them.
		if (block) for (const slot of [...block.values.keys()]) if (slot >= this.nextSlot) block.values.delete(slot)
	}

	clear() {
		this.blocks = []
		this.firstBlock = 0
		this.currentBlock = 0
		this.nextSlot = 0
		this.runStart = -1
	}

	kindAt(index: number): EffectKind {
		return EFFECT_KINDS[this.blockOf(index).kind[index % BLOCK_SIZE]]
	}

	aAt(index: number): number {
		return this.blockOf(index).a[index % BLOCK_SIZE]
	}

	bAt(index: number): number {
		return this.blockOf(index).b[index % BLOCK_SIZE]
	}

	valueAt(index: number): unknown {
		return this.blockOf(index).values.get(index % BLOCK_SIZE)
	}

	setA(index: number, value: number) {
		this.blockOf(index).a[index % BLOCK_SIZE] = value
	}

	setB(index: number, value: number) {
		this.blockOf(index).b[index % BLOCK_SIZE] = value
	}

	setValue(index: number, value: unknown) {
		this.blockOf(index).values.set(index % BLOCK_SIZE, value)
	}

	/** Blocks held, which is what the log costs beyond its entries. */
	get blockCount() {
		return this.blocks.length
	}

	private advanceBlock() {
		this.currentBlock += 1
		this.nextSlot = 0
		this.blockAt(this.currentBlock, true)
	}

	/**
	 * Moves the run being built into a fresh block, so the instruction's effects
	 * stay together.  Only what this instruction has recorded so far moves,
	 * which is a handful of slots.
	 */
	private carryRunToNextBlock() {
		const from = this.blockAt(this.currentBlock)!
		const start = this.runStart
		const carried = start < 0 ? 0 : this.position - start
		const firstSlot = start % BLOCK_SIZE

		this.advanceBlock()
		if (carried === 0) return

		const to = this.blockAt(this.currentBlock)!
		for (let offset = 0; offset < carried; offset++) {
			to.kind[offset] = from.kind[firstSlot + offset]
			to.a[offset] = from.a[firstSlot + offset]
			to.b[offset] = from.b[firstSlot + offset]
			const value = from.values.get(firstSlot + offset)
			if (value !== undefined) to.values.set(offset, value)
		}
		this.nextSlot = carried
		this.runStart = this.currentBlock * BLOCK_SIZE
	}

	/** Where the run being built now starts, which a carry may have moved. */
	get openRunStart() {
		return this.runStart
	}

	private blockAt(number: number, create = false): Block | undefined {
		const at = number - this.firstBlock
		if (create) while (this.blocks.length <= at) this.blocks.push(emptyBlock())
		return this.blocks[at]
	}

	private blockOf(index: number): Block {
		const block = this.blockAt(Math.floor(index / BLOCK_SIZE))
		if (!block) throw new Error(`History effect ${index} has been dropped`)
		return block
	}

	/**
	 * The effect as an object, for the history panel.  Only the rows on screen
	 * are ever built, so this costs nothing for a log nobody is looking at.
	 */
	materialize(index: number): Effect {
		const kind = this.kindAt(index)
		const a = this.aAt(index)
		const b = this.bAt(index)
		switch (kind) {
			case 'register': return { kind, name: REGISTER_FILE_NAMES[a], value: b }
			case 'fp': return { kind, index: a, value: b }
			case 'flag': return { kind, index: a, value: b !== 0 }
			case 'cp0': return { kind, index: a, value: b }
			case 'memory': return { kind, wordAddress: a, words: this.valueAt(index) as Array<number | undefined> }
			case 'console': return { kind, text: String(this.valueAt(index)) }
			case 'consoleReset': return { kind, value: String(this.valueAt(index)) }
			case 'display': return { kind, value: String(this.valueAt(index)) }
			case 'queuedInput': return { kind, value: String(this.valueAt(index)) }
			case 'call': return { kind, frame: this.valueAt(index) as CallFrame }
			case 'hiLo': return { kind, hi: a, lo: b }
			case 'heapPointer': return { kind, value: b }
			case 'halted': return { kind, value: b !== 0 }
			// `a` says whether the program had exited; `null` is not a number.
			case 'exitCode': return { kind, value: a === 0 ? null : b }
			case 'sleep': return { kind, value: b }
			case 'input': return { kind, value: String(this.valueAt(index)) }
		}
	}
}

/** Delay states as the codes the entry's own column holds. */
export const DELAY_STATES: DelayState[] = ['none', 'registered', 'triggered']

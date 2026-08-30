/**
 * The execution history: one entry per instruction, bounded by the backstep
 * limit.
 *
 * Entries are held the same way their effects are, in a rolling list of
 * fixed-size blocks. Dropping the oldest is dropping a block off the front of
 * that list, which frees a thousand entries for the cost of one short splice.
 * Taking them one at a time instead moves every entry behind them, so a full
 * log would copy itself on every instruction and the deeper the history the
 * slower the program ran.
 *
 * Every block but the last is full, so an entry's block is its index divided by
 * the block size: nothing has to be walked to reach one.
 *
 * The log therefore holds at least the limit, and at most one block more, since
 * a block is given up whole or not at all.
 */

import { BLOCK_SIZE } from './effectStore'
import type { HistoryEntry } from './types'

export class HistoryLog {
	private blocks: HistoryEntry[][] = [[]]
	private count = 0

	get length(): number {
		return this.count
	}

	/** Blocks held, which is what the log costs beyond the entries themselves. */
	get blockCount(): number {
		return this.blocks.length
	}

	at(index: number): HistoryEntry | undefined {
		if (index < 0 || index >= this.count) return undefined
		return this.blocks[Math.floor(index / BLOCK_SIZE)][index % BLOCK_SIZE]
	}

	/** A window of entries, which is what a virtualized panel draws. */
	slice(from: number, to: number): HistoryEntry[] {
		const window: HistoryEntry[] = []
		for (let index = Math.max(0, from); index < Math.min(this.count, to); index++) {
			window.push(this.at(index)!)
		}
		return window
	}

	/**
	 * Where the entry with this id sits, or -1 when it is no longer held.  Ids
	 * only ever increase along the log, so this need not walk it.
	 */
	indexOfId(id: number): number {
		let low = 0
		let high = this.count - 1
		while (low <= high) {
			const middle = (low + high) >> 1
			const found = this.at(middle)!.id
			if (found === id) return middle
			if (found < id) low = middle + 1
			else high = middle - 1
		}
		return -1
	}

	push(entry: HistoryEntry) {
		let last = this.blocks[this.blocks.length - 1]
		if (last.length >= BLOCK_SIZE) {
			last = []
			this.blocks.push(last)
		}
		last.push(entry)
		this.count += 1
	}

	/**
	 * Gives up whole blocks while what is left still covers the limit, and says
	 * how many entries went and which is now the oldest, so the caller can free
	 * what belonged to the ones dropped.
	 */
	evict(limit: number): { dropped: number, oldest: HistoryEntry | undefined } {
		let dropped = 0
		while (this.blocks.length > 1 && this.count - this.blocks[0].length >= limit) {
			dropped += this.blocks[0].length
			this.count -= this.blocks[0].length
			this.blocks.shift()
		}
		return { dropped, oldest: dropped > 0 ? this.at(0) : undefined }
	}

	/** Drops everything from `length` on, which a diverging run has left behind. */
	truncate(length: number) {
		if (length >= this.count) return
		const block = Math.floor(length / BLOCK_SIZE)
		this.blocks.length = block + 1
		this.blocks[block].length = length % BLOCK_SIZE
		this.count = length
	}

	clear() {
		this.blocks = [[]]
		this.count = 0
	}

	*[Symbol.iterator](): Iterator<HistoryEntry> {
		for (const block of this.blocks) yield* block
	}
}

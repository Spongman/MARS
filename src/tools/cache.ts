/**
 * Data cache simulator, following the THRAX tool of the same name.
 *
 * It models placement and replacement only: there is no backing store here,
 * because the point is the hit rate, not the data.  Instruction fetches are not
 * counted, matching the THRAX tool, which observes the data segment.
 */

import type { ExecutionObserver } from '../core/observer'

export type ReplacementPolicy = 'lru' | 'random' | 'fifo'

export interface CacheSettings {
	/** Total blocks in the cache. */
	blockCount: number
	/** Bytes per block. */
	blockSizeBytes: number
	/**
	 * Blocks per set.  1 is direct-mapped and `blockCount` is fully associative;
	 * anything between is set-associative.
	 */
	associativity: number
	replacement: ReplacementPolicy
}

export const DEFAULT_CACHE_SETTINGS: CacheSettings = {
	blockCount: 8,
	blockSizeBytes: 16,
	associativity: 1,
	replacement: 'lru',
}

interface CacheBlock {
	tag: number
	valid: boolean
	/** Access counter for LRU, or fill counter for FIFO. */
	order: number
}

export interface CacheSnapshot {
	settings: CacheSettings
	accesses: number
	hits: number
	misses: number
	hitRate: number
	/** Which blocks hold data, in set order, for the tool's block display. */
	blocks: Array<{ valid: boolean; tag: number }>
}

export class CacheSimulator implements ExecutionObserver {
	private settings: CacheSettings
	private blocks: CacheBlock[] = []
	private accesses = 0
	private hits = 0
	private clock = 0
	private setCount = 1

	constructor(settings: CacheSettings = DEFAULT_CACHE_SETTINGS) {
		this.settings = settings
		this.configure(settings)
	}

	configure(settings: CacheSettings) {
		const associativity = Math.max(1, Math.min(settings.associativity, settings.blockCount))
		this.settings = { ...settings, associativity }
		this.setCount = Math.max(1, Math.floor(settings.blockCount / associativity))
		this.reset()
	}

	reset() {
		this.blocks = Array.from({ length: this.setCount * this.settings.associativity }, () => ({ tag: 0, valid: false, order: 0 }))
		this.accesses = 0
		this.hits = 0
		this.clock = 0
	}

	onMemoryRead(address: number) {
		this.access(address)
	}

	onMemoryWrite(address: number) {
		this.access(address)
	}

	/** One access, counted as a hit or a miss and placed in its set. */
	access(address: number) {
		const { blockSizeBytes, associativity, replacement } = this.settings
		const blockNumber = Math.floor((address >>> 0) / blockSizeBytes)
		const setIndex = blockNumber % this.setCount
		const tag = Math.floor(blockNumber / this.setCount)
		const first = setIndex * associativity

		this.accesses += 1
		this.clock += 1

		for (let way = 0; way < associativity; way++) {
			const block = this.blocks[first + way]
			if (block.valid && block.tag === tag) {
				this.hits += 1
				// FIFO keeps the fill order, so only LRU restamps on a hit.
				if (replacement === 'lru') block.order = this.clock
				return
			}
		}

		this.blocks[first + this.victim(first, associativity, replacement)] = { tag, valid: true, order: this.clock }
	}

	/** The way to evict, by the configured policy; an invalid way wins first. */
	private victim(first: number, associativity: number, replacement: ReplacementPolicy): number {
		for (let way = 0; way < associativity; way++) {
			if (!this.blocks[first + way].valid) return way
		}
		if (replacement === 'random') return Math.floor(Math.random() * associativity)

		let oldest = 0
		for (let way = 1; way < associativity; way++) {
			if (this.blocks[first + way].order < this.blocks[first + oldest].order) oldest = way
		}
		return oldest
	}

	snapshot(): CacheSnapshot {
		const misses = this.accesses - this.hits
		return {
			settings: this.settings,
			accesses: this.accesses,
			hits: this.hits,
			misses,
			hitRate: this.accesses === 0 ? 0 : this.hits / this.accesses,
			blocks: this.blocks.map((block) => ({ valid: block.valid, tag: block.tag })),
		}
	}
}

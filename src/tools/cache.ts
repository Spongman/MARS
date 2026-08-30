/**
 * Data cache simulator.
 *
 * It models placement and replacement only: there is no backing store here,
 * because the point is the hit rate, not the data.  Instruction fetches are not
 * counted: only the data segment is observed.
 */

import type { ExecutionObserver } from '../core/observer'
import { RewindLog, type RewindableState } from './rewindLog'

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

/**
 * The cache these settings describe: associativity cannot exceed the cache, so
 * asking for more than the block count is a fully associative cache.  Callers
 * that show the settings use this, so the panel cannot disagree with the cache.
 */
export function effectiveCacheSettings(settings: CacheSettings): CacheSettings {
	return { ...settings, associativity: Math.max(1, Math.min(settings.associativity, settings.blockCount)) }
}

interface CacheState { blocks: CacheBlock[], accesses: number, hits: number, clock: number }

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
	/** The instruction now running, which tags the checkpoints it takes. */
	private at = 0
	private readonly history = new RewindLog<CacheState>()
	private readonly state: RewindableState<CacheState> = {
		capture: () => ({ blocks: this.blocks.map((block) => ({ ...block })), accesses: this.accesses, hits: this.hits, clock: this.clock }),
		restore: (state) => {
			this.blocks = state.blocks
			this.accesses = state.accesses
			this.hits = state.hits
			this.clock = state.clock
		},
	}

	onInstruction(_address: number, _decoded: unknown, instructionCount = 0) {
		this.at = instructionCount
	}

	onSeek(to: number) {
		this.history.seek(to, this.state)
	}

	constructor(settings: CacheSettings = DEFAULT_CACHE_SETTINGS) {
		this.settings = settings
		this.configure(settings)
	}

	configure(settings: CacheSettings) {
		this.settings = effectiveCacheSettings(settings)
		this.setCount = Math.max(1, Math.floor(settings.blockCount / this.settings.associativity))
		this.reset()
	}

	reset() {
		this.blocks = Array.from({ length: this.setCount * this.settings.associativity }, () => ({ tag: 0, valid: false, order: 0 }))
		this.accesses = 0
		this.hits = 0
		this.clock = 0
		this.history.clear()
	}

	onReset() {
		this.reset()
	}

	onMemoryRead(address: number) {
		this.access(address)
	}

	onMemoryWrite(address: number) {
		this.access(address)
	}

	/** One access, counted as a hit or a miss and placed in its set. */
	access(address: number) {
		this.history.record(this.at, this.state)
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

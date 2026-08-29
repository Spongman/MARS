/**
 * Instruction profile: how often each instruction ran, and how its branches
 * turned out.
 *
 * The source editor paints the counts as a heat map over the line numbers and
 * reports them on hover, so the snapshot carries the hottest count as well,
 * which is the top of that scale.
 */

import type { ExecutionObserver } from '../core/observer'

export interface AddressProfile {
	/** Times the instruction at this address ran. */
	count: number
	/** Conditional branches resolved here, by outcome. */
	taken: number
	notTaken: number
}

export interface ProfileSnapshot {
	byAddress: Map<number, AddressProfile>
	total: number
	/** Executions of the hottest instruction. */
	max: number
}

/** Heat steps the editor colours, coldest first. */
export const HEAT_LEVELS = 6

/**
 * Heat step for `count` against the hottest instruction of the run, or -1 for
 * an instruction that never ran.  The scale is logarithmic: an inner loop runs
 * orders of magnitude more often than the setup around it, and a linear scale
 * would leave everything but that loop the same cold colour.
 */
export function heatLevel(count: number, max: number) {
	if (count <= 0 || max <= 0) return -1
	if (count >= max) return HEAT_LEVELS - 1
	const share = Math.log(count) / Math.log(max)
	return Math.min(HEAT_LEVELS - 1, Math.floor(share * HEAT_LEVELS))
}

export class ExecutionProfile implements ExecutionObserver {
	private addresses = new Map<number, AddressProfile>()
	private total = 0
	private max = 0

	private entryFor(address: number) {
		const key = address >>> 0
		let entry = this.addresses.get(key)
		if (!entry) {
			entry = { count: 0, taken: 0, notTaken: 0 }
			this.addresses.set(key, entry)
		}
		return entry
	}

	onInstruction(address: number) {
		const entry = this.entryFor(address)
		entry.count += 1
		this.total += 1
		if (entry.count > this.max) this.max = entry.count
	}

	onBranch(address: number, taken: boolean) {
		const entry = this.entryFor(address)
		if (taken) entry.taken += 1
		else entry.notTaken += 1
	}

	reset() {
		this.addresses.clear()
		this.total = 0
		this.max = 0
	}

	snapshot(): ProfileSnapshot {
		const byAddress = new Map<number, AddressProfile>()
		for (const [address, entry] of this.addresses) byAddress.set(address, { ...entry })
		return { byAddress, total: this.total, max: this.max }
	}
}

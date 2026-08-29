/**
 * Execution events the THRAX tools observe.
 *
 * Tools watch a run rather than take part in it: nothing an observer does can
 * change what an instruction means.  The simulator holds a list of these and
 * skips the calls entirely when the list is empty, so an unopened tool costs
 * nothing.
 */

import type { Decoded } from './decoder'

export interface ExecutionObserver {
	/** Before `decoded` at `address` runs. */
	onInstruction?(address: number, decoded: Decoded): void
	/** A data read of `size` bytes; instruction fetches are not reported. */
	onMemoryRead?(address: number, size: number): void
	onMemoryWrite?(address: number, size: number): void
	/**
	 * A conditional branch resolved.  `target` is where it would go when taken,
	 * whether or not it was.
	 */
	onBranch?(address: number, taken: boolean, target: number): void
	/** Execution restarted, so accumulated counts belong to the previous run. */
	onReset?(): void
}

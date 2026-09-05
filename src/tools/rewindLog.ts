/**
 * Rolling a tool back and forward with the machine.
 *
 * A tool's numbers accumulate over the instructions that ran, and counts alone
 * cannot be inverted: a cache's replacement order and a predictor's counters
 * depend on the order they were reached in. The only reliable way back is the
 * state the tool was in before.
 *
 * Copying that state on every instruction would cost what the machine's own
 * snapshots used to. A tool is only reached by the instructions that concern
 * it, though, and its state is small, so a copy taken on each of those is cheap
 * and sparse: a cache records on a load or a store, a predictor on a branch.
 * That is the bargain the file table and the random streams already make.
 *
 * Like the machine's own log, a checkpoint holds the state that is **not** in
 * the tool, so seeking exchanges the two and one operation serves both
 * directions.
 */

/** A state the tool held, and the instruction count it held it before. */
interface Checkpoint<T> { at: number, state: T }

/**
 * How a tool hands its state over and takes one back.
 *
 * `previous` is the record about to be exchanged, for a tool that keeps deltas
 * rather than whole states: it names which slots to read, so the two sides of
 * the swap cover the same ground.  A tool that copies everything ignores it.
 */
export interface RewindableState<T> {
	capture(previous?: T): T
	restore(state: T): void
}

export class RewindLog<T> {
	private checkpoints: Checkpoint<T>[] = []
	/** How many checkpoints stand behind the present. */
	private cursor = 0

	/** Bounded like the machine's own log, so a long run cannot grow it forever. */
	constructor(private readonly limit = 2000) {}

	/**
	 * Keeps the state as it stands before the instruction at `at` changes it.
	 * One checkpoint per instruction: the first is the one to come back to.
	 */
	record(at: number, state: RewindableState<T>) {
		// Whatever stood ahead described a run that is no longer happening.
		if (this.cursor < this.checkpoints.length) this.checkpoints.length = this.cursor
		const last = this.checkpoints[this.checkpoints.length - 1]
		if (last && last.at === at) return
		this.checkpoints.push({ at, state: state.capture() })
		this.cursor = this.checkpoints.length
		if (this.checkpoints.length > this.limit) {
			this.checkpoints.shift()
			this.cursor--
		}
	}

	/**
	 * Moves the tool to where it stood before the instruction at `to`, in either
	 * direction. Each checkpoint crossed exchanges its state with the tool's, so
	 * going back and forward again lands on exactly what was there before.
	 */
	seek(to: number, state: RewindableState<T>) {
		while (this.cursor > 0 && this.checkpoints[this.cursor - 1].at >= to) {
			this.exchange(this.checkpoints[--this.cursor], state)
		}
		while (this.cursor < this.checkpoints.length && this.checkpoints[this.cursor].at < to) {
			this.exchange(this.checkpoints[this.cursor++], state)
		}
	}

	private exchange(checkpoint: Checkpoint<T>, state: RewindableState<T>) {
		const held = state.capture(checkpoint.state)
		state.restore(checkpoint.state)
		checkpoint.state = held
	}

	clear() {
		this.checkpoints = []
		this.cursor = 0
	}

	get length() {
		return this.checkpoints.length
	}
}

/**
 * Pseudo-random streams for syscalls 40-44.
 *
 * THRAX keeps a `java.util.Random` per identifier, so a program that seeds a
 * stream gets the same sequence there as it does here: this is that generator,
 * a 48-bit linear congruential engine, reproduced exactly.
 */

const MULTIPLIER = 0x5deece66dn
const ADDEND = 0xbn
const MASK = (1n << 48n) - 1n

export class JavaRandom {
	private seed: bigint

	constructor(seed?: number) {
		this.seed = 0n
		this.setSeed(seed ?? Date.now())
	}

	setSeed(seed: number) {
		this.seed = (BigInt.asUintN(64, BigInt(Math.trunc(seed))) ^ MULTIPLIER) & MASK
	}

	/** The top `bits` bits of the next state, as Java's `next(int)` returns them. */
	private next(bits: number): number {
		this.seed = (this.seed * MULTIPLIER + ADDEND) & MASK
		return Number(BigInt.asIntN(32, this.seed >> BigInt(48 - bits)))
	}

	nextInt(): number {
		return this.next(32)
	}

	/** A value in [0, bound), rejecting the values that would skew the range. */
	nextIntBounded(bound: number): number {
		if (bound <= 0) throw new Error(`Random bound (${bound}) must be positive`)
		if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n)

		for (;;) {
			const bits = this.next(31)
			const value = bits % bound
			// Retry when the final, short cycle of the range was drawn.
			if (bits - value + (bound - 1) >= 0) return value
		}
	}

	nextFloat(): number {
		return this.next(24) / (1 << 24)
	}

	nextDouble(): number {
		return (this.next(26) * 134217728 + this.next(27)) / 9007199254740992
	}
}

/** The set of named streams a program has used, created on first reference. */
export class RandomStreams {
	private streams = new Map<number, JavaRandom>()

	stream(id: number): JavaRandom {
		let stream = this.streams.get(id)
		if (!stream) {
			stream = new JavaRandom()
			this.streams.set(id, stream)
		}
		return stream
	}

	setSeed(id: number, seed: number) {
		this.stream(id).setSeed(seed)
	}
}

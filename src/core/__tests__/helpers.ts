import { Assembler } from '../assembler'
import { MipsSimulator } from '../simulator'

export function assemble(source: string) {
	return new Assembler(source).assemble()
}

/** Assembles `source` and returns its machine words as unsigned numbers. */
export function words(source: string): number[] {
	return assemble(source).machineCode.map((word) => word >>> 0)
}

export function build(source: string): MipsSimulator {
	const { program, machineCode } = assemble(source)
	return new MipsSimulator(machineCode, program)
}

/** Assembles and runs `source` to completion. */
export async function run(source: string): Promise<MipsSimulator> {
	const simulator = build(source)
	await simulator.run()
	return simulator
}

/** Runs `source` and returns everything it printed. */
export async function output(source: string): Promise<string> {
	return (await run(source)).console
}

/** A program body followed by a clean exit. */
export function withExit(body: string): string {
	return `${body}\nli $v0, 10\nsyscall\n`
}

/** Builds `source` with THRAX's delayed branching setting turned on. */
export function buildDelayed(source: string): MipsSimulator {
	const { program, machineCode } = new Assembler(source, undefined, { delayedBranching: true }).assemble()
	const simulator = new MipsSimulator(machineCode, program)
	simulator.delayedBranching = true
	return simulator
}

/** Runs `source` with delayed branching on. */
export async function runDelayed(source: string): Promise<MipsSimulator> {
	const simulator = buildDelayed(source)
	await simulator.run()
	return simulator
}

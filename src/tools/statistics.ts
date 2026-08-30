/**
 * Instruction statistics.
 *
 * Every executed instruction lands in exactly one category, so the counts sum
 * to the total.
 */

import type { Decoded } from '../core/decoder'
import type { ExecutionObserver } from '../core/observer'
import { RewindLog, type RewindableState } from './rewindLog'

export type InstructionCategory = 'alu' | 'jump' | 'branch' | 'memory' | 'coprocessor' | 'trap' | 'other'

export const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	alu: 'ALU',
	jump: 'Jump',
	branch: 'Branch',
	memory: 'Memory',
	coprocessor: 'Coprocessor',
	trap: 'Trap',
	other: 'Other',
}

// bgezal/bltzal branch-and-link like bltz/bgez, just also setting $ra
//.
const JUMPS = new Set(['J', 'JAL', 'JR', 'JALR'])
const BRANCHES = new Set(['BEQ', 'BNE', 'BGEZ', 'BGTZ', 'BLEZ', 'BLTZ', 'BC1T', 'BC1F', 'BGEZAL', 'BLTZAL'])
// The unaligned halves and the load-linked/store-conditional pair are memory
// accesses like the rest; without them they fell through to 'other'.
const MEMORY = new Set([
	'LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB', 'LWC1', 'LDC1', 'SWC1', 'SDC1',
	'LWL', 'LWR', 'SWL', 'SWR', 'LL', 'SC',
])
// clo/clz (bit counting) and madd/maddu/msub/msubu (multiply-accumulate) are plain
// integer arithmetic, alongside the existing mult/div family they extend
//. movn/movz are a GPR-to-GPR
// conditional move with no FPU or CP0 involvement, so they must be listed here ahead
// of the 'MOV' prefix catch-all below, which would otherwise claim them as coprocessor
// work alongside movn.s/movz.s.
const ALU = new Set([
	'ADD', 'ADDU', 'ADDI', 'ADDIU', 'SUB', 'SUBU', 'MUL', 'MULT', 'MULTU', 'DIV', 'DIVU',
	'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR',
	'SLL', 'SRL', 'SRA', 'SLLV', 'SRLV', 'SRAV',
	'SLT', 'SLTU', 'SLTI', 'SLTIU', 'LUI',
	'MFHI', 'MFLO', 'MTHI', 'MTLO',
	'CLO', 'CLZ', 'MADD', 'MADDU', 'MSUB', 'MSUBU',
	'MOVN', 'MOVZ',
])
// A trap is neither ALU (it commits no result register), memory, nor coprocessor
// work: it compares two operands like slt and conditionally raises an exception
// instead.  So traps get a category of their own rather than a catch-all.
const TRAPS = new Set(['TEQ', 'TEQI', 'TGE', 'TGEU', 'TGEI', 'TGEIU', 'TLT', 'TLTU', 'TLTI', 'TLTIU', 'TNE', 'TNEI'])

export function categoryOf(op: string): InstructionCategory {
	if (JUMPS.has(op)) return 'jump'
	if (BRANCHES.has(op)) return 'branch'
	if (MEMORY.has(op)) return 'memory'
	if (ALU.has(op)) return 'alu'
	if (TRAPS.has(op)) return 'trap'
	// Everything the FPU and CP0 do, including the dotted mnemonics: movn.s/movz.s and
	// movf.s/movt.s/movf.d/movt.d (FP-register conditional moves) land here too.
	if (op.includes('.') || op.startsWith('MFC') || op.startsWith('MTC') || op.startsWith('MOV') || op === 'ERET') {
		return 'coprocessor'
	}
	return 'other'
}

/**
 * The three encodings an instruction word can have: R has three register
 * fields and a function code, I an immediate, and J a 26-bit target.
 */
export type InstructionFormat = 'R' | 'I' | 'J'

export const FORMAT_LABELS: Record<InstructionFormat, string> = {
	R: 'R-format',
	I: 'I-format',
	J: 'J-format',
}

export interface StatisticsSnapshot {
	total: number
	byCategory: Record<InstructionCategory, number>
	/** Counts by encoding, which is what the machine word looks like. */
	byFormat: Record<InstructionFormat, number>
	/** Executed counts per mnemonic, most frequent first. */
	byMnemonic: Array<{ op: string; count: number }>
}

/**
 * Which encoding a word uses, read off the word itself rather than the
 * mnemonic: the opcode alone decides it, with 0 and 0x1c naming the two
 * R-format groups and 2 and 3 the only jumps that carry a target.
 */
export function formatOf(word: number): InstructionFormat {
	const opcode = (word >>> 26) & 0x3f
	if (opcode === 0 || opcode === 0x1c) return 'R'
	if (opcode === 2 || opcode === 3) return 'J'
	// The coprocessor opcodes hold a format field where an immediate would be,
	// and their operands are registers, so they are R-format words.
	if (opcode === 0x10 || opcode === 0x11) return 'R'
	return 'I'
}

interface StatisticsState {
	total: number
	categories: Map<InstructionCategory, number>
	mnemonics: Map<string, number>
	formats: Map<InstructionFormat, number>
}

export class InstructionStatistics implements ExecutionObserver {
	private total = 0
	private categories = new Map<InstructionCategory, number>()
	private mnemonics = new Map<string, number>()
	private formats = new Map<InstructionFormat, number>()
	private readonly history = new RewindLog<StatisticsState>()
	private readonly state: RewindableState<StatisticsState> = {
		capture: () => ({
			total: this.total,
			categories: new Map(this.categories),
			mnemonics: new Map(this.mnemonics),
			formats: new Map(this.formats),
		}),
		restore: (state) => {
			this.total = state.total
			this.categories = state.categories
			this.mnemonics = state.mnemonics
			this.formats = state.formats
		},
	}

	onSeek(to: number) {
		this.history.seek(to, this.state)
	}

	onInstruction(_address: number, decoded: Decoded, instructionCount = 0) {
		this.history.record(instructionCount, this.state)
		this.total += 1
		const category = categoryOf(decoded.op)
		this.categories.set(category, (this.categories.get(category) ?? 0) + 1)
		this.mnemonics.set(decoded.op, (this.mnemonics.get(decoded.op) ?? 0) + 1)
		const encoding = formatOf(decoded.word)
		this.formats.set(encoding, (this.formats.get(encoding) ?? 0) + 1)
	}

	reset() {
		this.total = 0
		this.categories.clear()
		this.mnemonics.clear()
		this.formats.clear()
		this.history.clear()
	}

	onReset() {
		this.reset()
	}

	snapshot(): StatisticsSnapshot {
		const byCategory = {} as Record<InstructionCategory, number>
		for (const category of Object.keys(CATEGORY_LABELS) as InstructionCategory[]) {
			byCategory[category] = this.categories.get(category) ?? 0
		}
		const byFormat = { R: 0, I: 0, J: 0 } as Record<InstructionFormat, number>
		for (const encoding of Object.keys(FORMAT_LABELS) as InstructionFormat[]) {
			byFormat[encoding] = this.formats.get(encoding) ?? 0
		}
		return {
			total: this.total,
			byCategory,
			byFormat,
			byMnemonic: [...this.mnemonics.entries()]
				.map(([op, count]) => ({ op, count }))
				.sort((left, right) => right.count - left.count || left.op.localeCompare(right.op)),
		}
	}
}

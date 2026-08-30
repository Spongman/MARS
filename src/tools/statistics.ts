/**
 * Instruction statistics, the counting half of the THRAX tool of that name.
 *
 * Categories follow THRAX: every executed instruction lands in exactly one, so
 * the category counts sum to the total.
 */

import type { Decoded } from '../core/decoder'
import type { ExecutionObserver } from '../core/observer'

export type InstructionCategory = 'alu' | 'jump' | 'branch' | 'memory' | 'coprocessor' | 'other'

export const CATEGORY_LABELS: Record<InstructionCategory, string> = {
	alu: 'ALU',
	jump: 'Jump',
	branch: 'Branch',
	memory: 'Memory',
	coprocessor: 'Coprocessor',
	other: 'Other',
}

const JUMPS = new Set(['J', 'JAL', 'JR', 'JALR'])
const BRANCHES = new Set(['BEQ', 'BNE', 'BGEZ', 'BGTZ', 'BLEZ', 'BLTZ', 'BC1T', 'BC1F'])
const MEMORY = new Set(['LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB', 'LWC1', 'LDC1', 'SWC1', 'SDC1'])
const ALU = new Set([
	'ADD', 'ADDU', 'ADDI', 'ADDIU', 'SUB', 'SUBU', 'MUL', 'MULT', 'MULTU', 'DIV', 'DIVU',
	'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR',
	'SLL', 'SRL', 'SRA', 'SLLV', 'SRLV', 'SRAV',
	'SLT', 'SLTU', 'SLTI', 'SLTIU', 'LUI',
	'MFHI', 'MFLO', 'MTHI', 'MTLO',
])

export function categoryOf(op: string): InstructionCategory {
	if (JUMPS.has(op)) return 'jump'
	if (BRANCHES.has(op)) return 'branch'
	if (MEMORY.has(op)) return 'memory'
	if (ALU.has(op)) return 'alu'
	// Everything the FPU and CP0 do, including the dotted mnemonics.
	if (op.includes('.') || op.startsWith('MFC') || op.startsWith('MTC') || op.startsWith('MOV') || op === 'ERET') {
		return 'coprocessor'
	}
	return 'other'
}

export interface StatisticsSnapshot {
	total: number
	byCategory: Record<InstructionCategory, number>
	/** Executed counts per mnemonic, most frequent first. */
	byMnemonic: Array<{ op: string; count: number }>
}

export class InstructionStatistics implements ExecutionObserver {
	private total = 0
	private categories = new Map<InstructionCategory, number>()
	private mnemonics = new Map<string, number>()

	onInstruction(_address: number, decoded: Decoded) {
		this.total += 1
		const category = categoryOf(decoded.op)
		this.categories.set(category, (this.categories.get(category) ?? 0) + 1)
		this.mnemonics.set(decoded.op, (this.mnemonics.get(decoded.op) ?? 0) + 1)
	}

	reset() {
		this.total = 0
		this.categories.clear()
		this.mnemonics.clear()
	}

	onReset() {
		this.reset()
	}

	snapshot(): StatisticsSnapshot {
		const byCategory = {} as Record<InstructionCategory, number>
		for (const category of Object.keys(CATEGORY_LABELS) as InstructionCategory[]) {
			byCategory[category] = this.categories.get(category) ?? 0
		}
		return {
			total: this.total,
			byCategory,
			byMnemonic: [...this.mnemonics.entries()]
				.map(([op, count]) => ({ op, count }))
				.sort((left, right) => right.count - left.count || left.op.localeCompare(right.op)),
		}
	}
}

import { Assembler } from '../core/assembler'
import { bitsToDouble, bitsToSingle, formatDouble, formatSingle } from '../core/coprocessor'
import { formatWord, memoryKey, parseWord } from '../core/format'
import { REGISTER_NAMES } from '../core/registers'
import type { MemoryView, Registers } from '../core/types'

interface DebugDataTipState {
	code: string
	registers: Registers
	memory: MemoryView
	fpRegisters: number[]
}

interface MonacoLike {
	Range: new (startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) => unknown
	languages: {
		registerHoverProvider: (languageId: string, provider: {
			provideHover: (model: MonacoModel, position: MonacoPosition) => MonacoHover | null
		}) => { dispose: () => void }
	}
}

interface MonacoModel {
	getLineContent: (lineNumber: number) => string
}

interface MonacoPosition {
	lineNumber: number
	column: number
}

interface MonacoHover {
	range: unknown
	contents: Array<{ value: string }>
}

function formatValue(value: number) {
	const unsigned = value >>> 0
	return `${formatWord(unsigned)} (${value | 0}, unsigned ${unsigned})`
}

function getRegisterValue(register: string, registers: Registers) {
	const normalized = register.toLowerCase()
	if (/^\$\d+$/.test(normalized)) {
		const alias = REGISTER_NAMES[Number(normalized.slice(1))]
		if (alias) return { name: alias, value: registers[alias] ?? 0 }
	}
	return { name: normalized, value: registers[normalized] ?? 0 }
}

/** Hover contents for `$f0`-`$f31`, including the double a pair holds. */
function getFpRegisterContents(index: number, fpRegisters: number[]) {
	const bits = fpRegisters[index] ?? 0
	const contents = [
		`**$f${index}**`,
		`single \`${formatSingle(bitsToSingle(bits))}\``,
		`bits \`${formatWord(bits)}\``,
	]
	if (index % 2 === 0) {
		contents.push(`double \`${formatDouble(bitsToDouble(bits, fpRegisters[index + 1] ?? 0))}\``)
	}
	return contents.map((value) => ({ value }))
}

function getTokenRange(monaco: MonacoLike, position: MonacoPosition, start: number, length: number) {
	return new monaco.Range(position.lineNumber, start + 1, position.lineNumber, start + length + 1)
}

/** Installs live MIPS register, label, literal, and address hover data tips. */
export function registerMipsDebugDataTips(monaco: MonacoLike, getState: () => DebugDataTipState) {
	let cachedCode = ''
	let cachedLabels = new Map<string, number>()

	const getLabels = (code: string) => {
		if (code === cachedCode) return cachedLabels
		cachedCode = code
		try {
			cachedLabels = new Assembler(code).assemble().program.labels
		} catch {
			cachedLabels = new Map()
		}
		return cachedLabels
	}

	return monaco.languages.registerHoverProvider('mips', {
		provideHover(model, position) {
			const state = getState()
			const line = model.getLineContent(position.lineNumber)
			const offset = position.column - 1
			const labels = getLabels(state.code)

			const memoryMatch = /(-?(?:0x[0-9a-f]+|\d+)|[A-Za-z_]\w*)?\s*\(\s*(\$(?:[A-Za-z]\w*|\d+))\s*\)/ig
			for (const match of line.matchAll(memoryMatch)) {
				const start = match.index ?? 0
				if (offset < start || offset > start + match[0].length) continue
				const offsetText = match[1]
				const base = getRegisterValue(match[2], state.registers)
				const displacement = offsetText ? (parseWord(offsetText) ?? labels.get(offsetText) ?? 0) : 0
				const address = (base.value + displacement) >>> 0
				const value = state.memory[memoryKey(address)] ?? 0
				return {
					range: getTokenRange(monaco, position, start, match[0].length),
					contents: [
						{ value: '**Effective address**' },
						{ value: `\`${memoryKey(address)}\` = \`${formatValue(value)}\`` },
						{ value: `base \`${base.name}\` ${formatValue(base.value)} + offset ${formatValue(displacement)}` },
					],
				}
			}

			const registerMatch = /\$(?:[A-Za-z]\w*|\d+)/g
			for (const match of line.matchAll(registerMatch)) {
				const start = match.index ?? 0
				if (offset < start || offset > start + match[0].length) continue
				const fpRegister = /^\$f(\d{1,2})$/i.exec(match[0])
				if (fpRegister && Number(fpRegister[1]) < 32) {
					return {
						range: getTokenRange(monaco, position, start, match[0].length),
						contents: getFpRegisterContents(Number(fpRegister[1]), state.fpRegisters),
					}
				}
				const register = getRegisterValue(match[0], state.registers)
				return {
					range: getTokenRange(monaco, position, start, match[0].length),
					contents: [{ value: `**${register.name}**\n\n\`${formatValue(register.value)}\`` }],
				}
			}

			const tokenMatch = /-?(?:0x[0-9a-f]+|\d+)|[A-Za-z_]\w*/ig
			for (const match of line.matchAll(tokenMatch)) {
				const start = match.index ?? 0
				if (offset < start || offset > start + match[0].length) continue
				const number = parseWord(match[0])
				if (number !== null) {
					return {
						range: getTokenRange(monaco, position, start, match[0].length),
						contents: [{ value: `**Immediate**\n\n\`${formatValue(number)}\`` }],
					}
				}
				const labelAddress = labels.get(match[0])
				if (labelAddress !== undefined) {
					return {
						range: getTokenRange(monaco, position, start, match[0].length),
						contents: [{ value: `**Label ${match[0]}**\n\n\`${memoryKey(labelAddress)}\`` }],
					}
				}
			}
			return null
		},
	})
}

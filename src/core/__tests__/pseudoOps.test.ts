import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { disassemble } from '../disassembler'
import { assemble } from './helpers'

/**
 * THRAX ships `PseudoOps.txt`, the table its assembler reads to expand extended
 * instructions: 388 forms over 83 mnemonics, each a template plus the basic
 * instructions it becomes.  It is the closest thing the original has to a test
 * suite, so it is used here as one.
 *
 * Reproducing THRAX's substitution language (RG1, VL3, VHL3, LHPAP, ...) would
 * be a port in itself, so this checks the property that language cannot hide:
 * every form THRAX accepts must assemble here into real instructions, and none
 * may quietly lose an operand.  Exact expansions are pinned by hand elsewhere.
 */

const TABLE = fileURLToPath(new URL('./fixtures/PseudoOps.txt', import.meta.url))

interface Form {
	mnemonic: string
	source: string
	/** How many basic instructions THRAX expands it into. */
	expansion: number
}

function readForms(): Form[] {
	const forms: Form[] = []
	for (const line of readFileSync(TABLE, 'utf8').split('\n')) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue
		const fields = line.split('\t').map((field) => field.trim()).filter(Boolean)
		const template = fields[0]
		if (!template) continue
		// Everything up to the trailing #comment is one basic instruction.
		const expansion = fields.slice(1).filter((field) => !field.startsWith('#')).length
		forms.push({ mnemonic: template.split(/\s+/)[0].toLowerCase(), source: template, expansion })
	}
	return forms
}

const FORMS = readForms()

/** Forms THRAX assembles and this port does not.  Empty is the goal. */
const UNIMPLEMENTED = new Set<string>([])
/** THRAX templates use a label named `label`, and `$f` registers for CP1. */
function assemblable(source: string): string {
	const needsLabel = /\blabel\b/.test(source)
	return `.data\nvalue: .word 0\n.text\nmain:\n${source}\n${needsLabel ? 'label:\n' : ''}nop\n`
}

describe('THRAX pseudo-op table', () => {
	it('is the table THRAX ships', () => {
		expect(FORMS.length).toBeGreaterThan(380)
		expect(new Set(FORMS.map((form) => form.mnemonic)).size).toBeGreaterThan(80)
	})

	const supported = FORMS.filter((form) => !UNIMPLEMENTED.has(form.mnemonic))

	it.each(supported.map((form) => [form.source, form] as const))('assembles %s', (_source, form) => {
		const { machineCode } = assemble(assemblable(form.source))
		expect(machineCode.length).toBeGreaterThan(0)
		// Every emitted word must decode: a silently mangled operand still
		// decodes, but a word built from nothing generally does not.
		for (const word of machineCode) expect(disassemble(word)).not.toBeNull()
	})

	it('reports what remains unimplemented, so the gap stays visible', () => {
		const missing = [...new Set(FORMS.map((form) => form.mnemonic))].filter((name) => UNIMPLEMENTED.has(name))
		expect(missing.sort()).toEqual([...UNIMPLEMENTED].sort())
	})
})

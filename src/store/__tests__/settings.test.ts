import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../core/settings'

const storage = new Map<string, string>()

// The store reads its settings while it is being created, so storage has to
// answer before the module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

// A setting left on from a previous session, under the key the toolbar toggle
// used before the dialog existed.
storage.set('thrax-web.settings.assemble.delayedBranching', 'true')

const { useTHRAXStore } = await import('../thraxStore')

describe('settings', () => {
	it('starts at the MARS defaults, apart from what was stored', () => {
		expect(useTHRAXStore.getState().settings).toEqual({ ...DEFAULT_SETTINGS, delayedBranching: true })
	})

	it('round-trips a setting through the store and its persistence key', () => {
		useTHRAXStore.getState().setSetting('backstepLimit', 500)
		expect(useTHRAXStore.getState().settings.backstepLimit).toBe(500)
		expect(storage.get('thrax-web.settings.simulate.backstepLimit')).toBe('500')

		// The two settings that were toolbar toggles keep the keys they had.
		useTHRAXStore.getState().setSetting('assembleAll', true)
		expect(storage.get('thrax-web.settings.assemble.allFiles')).toBe('true')
		useTHRAXStore.getState().setSetting('delayedBranching', false)
		expect(storage.get('thrax-web.settings.assemble.delayedBranching')).toBe('false')
	})

	it('drops the running program when an assembly setting changes', () => {
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().instructionCount).toBe(1)

		// Nothing the assembler reads, so the program keeps running.
		useTHRAXStore.getState().setSetting('displayValuesInHex', false)
		expect(useTHRAXStore.getState().instructionCount).toBe(1)

		useTHRAXStore.getState().setSetting('extendedAssembler', false)
		expect(useTHRAXStore.getState().instructionCount).toBe(0)
		expect(useTHRAXStore.getState().codeWords.size).toBe(0)
		// Put it back: the assembler really reads this one now, so leaving it off
		// would refuse the pseudo-instructions the later cases assemble.
		useTHRAXStore.getState().setSetting('extendedAssembler', true)
	})

	it('reaches the assembler, so the delay slot runs when the setting is on', () => {
		useTHRAXStore.getState().setCode('main:\n\tbeq $zero, $zero, skip\n\taddi $t0, $zero, 7\nskip:\n\tnop\n')

		useTHRAXStore.getState().setSetting('delayedBranching', false)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().registers.$t0).toBe(0)

		useTHRAXStore.getState().setSetting('delayedBranching', true)
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		useTHRAXStore.getState().step()
		expect(useTHRAXStore.getState().registers.$t0).toBe(7)
	})
})

describe('self-modifying code', () => {
	// A store aimed at the first word of .text, which is the program itself.
	const intoText = `li $t0, 0x00400000
sw $zero, 0($t0)
li $v0, 10
syscall
`

	it('reaches the simulator, so a store into text faults when it is off', async () => {
		useTHRAXStore.getState().setSetting('selfModifyingCode', false)
		useTHRAXStore.setState({ code: intoText })
		await useTHRAXStore.getState().run()
		expect(useTHRAXStore.getState().console).toMatch(/text segment/i)
	})

	it('lets the same store through when it is on', async () => {
		useTHRAXStore.getState().setSetting('selfModifyingCode', true)
		useTHRAXStore.setState({ code: intoText })
		await useTHRAXStore.getState().run()
		expect(useTHRAXStore.getState().console).not.toMatch(/text segment/i)
	})
})

describe('extended assembler', () => {
	const pseudo = 'move $t0, $t1'

	it('reaches the assembler, so a pseudo-instruction is refused when it is off', () => {
		useTHRAXStore.getState().setSetting('extendedAssembler', false)
		useTHRAXStore.setState({ code: pseudo })
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics.some((one) => /not permitted/i.test(one.message))).toBe(true)
	})

	it('assembles the same source when it is on', () => {
		useTHRAXStore.getState().setSetting('extendedAssembler', true)
		useTHRAXStore.setState({ code: pseudo })
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics.some((one) => /not permitted/i.test(one.message))).toBe(false)
	})
})

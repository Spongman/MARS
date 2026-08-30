import { beforeEach, describe, expect, it } from 'vitest'
import type { ExecutionObserver, MachineConfig } from '../../core/observer'
import { build, withExit } from '../../core/__tests__/helpers'
import { PipelineModel } from '../pipeline'
import { ToolRegistry, createToolRegistry, type Tool } from '../registry'

const store = new Map<string, string>()

// The stored-setting helpers reach for `window` when they are called, not when
// they are imported, so a stub is all the node environment needs.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => { store.set(key, value) },
		},
	},
	writable: true,
})

interface FakeSettings {
	label: string
}

const FAKE_DEFAULTS: FakeSettings = { label: 'default' }

/** A tool with no simulator behind it, so the registry can be driven directly. */
class FakeTool implements Tool<FakeSettings, { label: string, reads: number }> {
	settings: FakeSettings = FAKE_DEFAULTS
	machines: MachineConfig[] = []
	reads = 0
	resets = 0

	configure(settings: FakeSettings) {
		this.settings = settings
	}

	onConfigure(machine: MachineConfig) {
		this.machines.push(machine)
	}

	onMemoryRead() {
		this.reads += 1
	}

	onReset() {
		this.resets += 1
		this.reads = 0
	}

	snapshot() {
		return { label: this.settings.label, reads: this.reads }
	}
}

const isFakeSettings = (value: unknown) => typeof (value as FakeSettings | null)?.label === 'string'

function fakeRegistry() {
	const tool = new FakeTool()
	const other = new FakeTool()
	const registry = new ToolRegistry([
		{ key: 'fake', tool, setting: { storageKey: 'tools.fake', defaults: FAKE_DEFAULTS, isValid: isFakeSettings } },
		{ key: 'other', tool: other },
	] as const)
	return { tool, other, registry }
}

/** Only the observer list matters to the registry, so a stand-in will do. */
const fakeSimulator = () => ({ observers: [] as ExecutionObserver[] })

describe('tool registry', () => {
	beforeEach(() => store.clear())

	it('starts every tool on the machine it is attached to', () => {
		const { tool, other, registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.attach(simulator, { delayedBranching: true })

		expect(tool.resets).toBe(1)
		expect(other.resets).toBe(1)
		expect(tool.machines).toEqual([{ delayedBranching: true }])
		expect(other.machines).toEqual([{ delayedBranching: true }])
		expect(simulator.observers).toHaveLength(2)
	})

	it('reaches the tools through the observer interface alone', () => {
		const { tool, registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.attach(simulator, { delayedBranching: false })

		const observer = simulator.observers[0]
		expect(observer).not.toBe(tool)
		// A callback the tool does not implement is left off, so the simulator skips it.
		expect(observer.onInstruction).toBeUndefined()
		observer.onMemoryRead?.(0x10010000, 4)
		expect(tool.reads).toBe(1)
	})

	it('re-snapshots only the tools that saw something', () => {
		const { registry } = fakeRegistry()
		const simulator = fakeSimulator()
		registry.attach(simulator, { delayedBranching: false })

		const first = registry.views()
		expect(registry.views().fake).toBe(first.fake)

		simulator.observers[0].onMemoryRead?.(0x10010000, 4)
		const second = registry.views()
		expect(second.fake).not.toBe(first.fake)
		expect(second.fake.reads).toBe(1)
		// The tool that saw nothing keeps the reading the view already has.
		expect(second.other).toBe(first.other)
		expect(registry.views().fake).toBe(second.fake)
	})

	it('configures the tool and remembers the choice', () => {
		const { tool, registry } = fakeRegistry()
		registry.setSettings('fake', { label: 'chosen' })

		expect(tool.settings).toEqual({ label: 'chosen' })
		expect(store.get('thrax-web.settings.tools.fake')).toBe('{"label":"chosen"}')
		expect(registry.views().fake.label).toBe('chosen')
	})

	it('applies what was stored, and falls back for a value the validator refuses', () => {
		store.set('thrax-web.settings.tools.fake', '{"label":"stored"}')
		const stored = fakeRegistry()
		expect(stored.registry.loadSettings()).toEqual({ fake: { label: 'stored' } })
		expect(stored.tool.settings).toEqual({ label: 'stored' })

		store.set('thrax-web.settings.tools.fake', '{"label":7}')
		const refused = fakeRegistry()
		expect(refused.registry.loadSettings()).toEqual({ fake: FAKE_DEFAULTS })
		expect(refused.tool.settings).toEqual(FAKE_DEFAULTS)
	})

	it('gives the pipeline model its delay slots, and a reset leaves them alone', () => {
		const pipeline = new PipelineModel()
		const registry = new ToolRegistry([{ key: 'pipeline', tool: pipeline }] as const)

		registry.attach(fakeSimulator(), { delayedBranching: true })
		expect(pipeline.delaySlots).toBe(true)

		registry.resetAll()
		expect(pipeline.delaySlots).toBe(true)
	})

	it('collects and clears the readings of every registered tool', async () => {
		const registry = createToolRegistry()
		const simulator = build(withExit('li $t0, 2\nloop:\naddi $t0, $t0, -1\nsw $t0, 0($sp)\nlw $t1, 0($sp)\nbne $t0, $zero, loop'))
		registry.attach(simulator, { delayedBranching: false })
		await simulator.run()

		const ran = registry.views()
		expect(ran.statistics.total).toBe(simulator.instructionCount)
		expect(ran.profile.total).toBe(simulator.instructionCount)
		expect(ran.cache.accesses).toBe(4)
		expect(ran.branchHistory.predictions).toBe(2)
		expect(ran.pipeline.instructions).toBe(simulator.instructionCount)

		registry.resetAll()
		const cleared = registry.views()
		expect(cleared.statistics.total).toBe(0)
		expect(cleared.profile.total).toBe(0)
		expect(cleared.cache.accesses).toBe(0)
		expect(cleared.branchHistory.predictions).toBe(0)
		expect(cleared.pipeline.instructions).toBe(0)
	})
})

import { describe, expect, it } from 'vitest'
import type { AddPanelOptions, DockviewApi, IDockviewPanel, SerializedDockview } from 'dockview-react'

const storage = new Map<string, string>()

// The store and the layout both read storage as they are created, so it has to
// answer before either module is imported.
Object.defineProperty(globalThis, 'window', {
	value: {
		localStorage: {
			getItem: (key: string) => storage.get(key) ?? null,
			setItem: (key: string, value: string) => { storage.set(key, value) },
		},
	},
	writable: true,
})

const LAYOUT_KEY = 'thrax-web.dock-layout'
/**
 * Written out rather than imported: a release that bumps the version throws
 * away every layout stored by the release before it, so this pins the version
 * a shipped layout carries and fails if it moves.
 */
const SHIPPED_LAYOUT_VERSION = 2

/** The panels a layout stored before the ported tools existed would name. */
const OLD_PANELS = ['registers', 'callStack', 'bitmap', 'keyboardDisplay', 'statistics', 'cache', 'branchHistory', 'memory', 'pipeline', 'xray', 'console']

function storeLayout(components: string[]) {
	const panels = Object.fromEntries(components.map((component) => [component, { id: component, contentComponent: component }]))
	const layout = { grid: { root: {}, width: 800, height: 600, orientation: 'HORIZONTAL' }, panels } as unknown as SerializedDockview
	storage.set(LAYOUT_KEY, JSON.stringify({ version: SHIPPED_LAYOUT_VERSION, layout }))
}

/** Only the handful of methods buildLayout drives, over a plain list of panels. */
function fakeApi() {
	const panels: IDockviewPanel[] = []
	const added: AddPanelOptions[] = []
	let restoredFrom: SerializedDockview | null = null
	let cleared = 0
	const panel = (id: string, title?: string) => ({
		id,
		title,
		api: { setActive: () => {}, setTitle: () => {} },
	} as unknown as IDockviewPanel)
	const api = {
		get panels() { return panels },
		getPanel: (id: string) => panels.find((candidate) => candidate.id === id),
		addPanel: (options: AddPanelOptions) => {
			added.push(options)
			const created = panel(options.id, options.title)
			panels.push(created)
			return created
		},
		removePanel: (target: IDockviewPanel) => { panels.splice(panels.indexOf(target), 1) },
		fromJSON: (layout: SerializedDockview) => {
			restoredFrom = layout
			for (const id of Object.keys(layout.panels)) panels.push(panel(id))
		},
		clear: () => { cleared += 1; panels.length = 0 },
	}
	return {
		api: api as unknown as DockviewApi,
		added,
		ids: () => panels.map((candidate) => candidate.id),
		restored: () => restoredFrom,
		cleared: () => cleared,
	}
}

const { buildLayout } = await import('../../components/DockLayout')

describe('dock layout', () => {
	it('keeps a layout stored before the ported panels existed, and adds them to it', () => {
		storeLayout(OLD_PANELS)
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		// The stored arrangement was restored, not thrown away for the default one.
		expect(dock.restored()).not.toBeNull()
		expect(dock.cleared()).toBe(0)
		for (const id of OLD_PANELS) expect(dock.ids()).toContain(id)

		// The panels it predates are added beside the ones they belong with.
		const addedTools = dock.added.filter((options) => options.component !== 'source')
		expect(addedTools.map((options) => options.id)).toEqual(['symbols', 'memoryReference', 'screenMagnifier', 'introToTools', 'history', 'marsBot', 'scavengerHunt', 'digitalLab'])
		for (const options of addedTools) {
			const reference = options.position && 'referencePanel' in options.position ? options.position.referencePanel : undefined
			expect(OLD_PANELS).toContain(reference)
		}
	})

	it('starts over only when a stored layout names a panel that no longer exists', () => {
		storeLayout([...OLD_PANELS, 'retired'])
		const dock = fakeApi()
		buildLayout(dock.api, new Set())

		expect(dock.restored()).toBeNull()
		expect(dock.ids()).toContain('marsBot')
	})
})

import { describe, expect, it } from 'vitest'
import { useTHRAXStore } from '../thraxStore'

describe('store smoke', () => {
	it('seeds the tool views and settings from the registry', () => {
		const state = useTHRAXStore.getState()
		expect(state.statistics.total).toBe(0)
		expect(state.profile.total).toBe(0)
		expect(state.cache.settings.blockCount).toBe(8)
		expect(state.branchHistory.entries).toHaveLength(16)
		expect(state.pipeline.settings.windowSize).toBe(24)
		expect(state.cacheSettings.blockCount).toBe(8)
		expect(state.branchHistorySettings.entryCount).toBe(16)
		expect(state.pipelineSettings.windowSize).toBe(24)
	})

	it('assembles and steps, moving the tool readings', () => {
		useTHRAXStore.getState().assemble()
		useTHRAXStore.getState().step()
		const state = useTHRAXStore.getState()
		expect(state.statistics.total).toBe(1)
		expect(state.profile.total).toBe(1)
		expect(state.pipeline.instructions).toBe(1)
		// A tool that saw nothing keeps its reading, so its panel does not redraw.
		expect(useTHRAXStore.getState().cache).toBe(state.cache)
	})

	it('reports assembly errors as diagnostics rather than throwing', async () => {
		useTHRAXStore.getState().setCode('main:\n\tj missing\n')
		useTHRAXStore.getState().refreshAssembly()
		const afterRefresh = useTHRAXStore.getState()
		expect(afterRefresh.diagnostics).toHaveLength(1)
		expect(afterRefresh.diagnostics[0]).toMatchObject({ severity: 'error', line: 2, file: 'main.asm' })
		// Editing reports live without disturbing the console.
		expect(afterRefresh.console).not.toContain('Error:')

		// Running says so in the console, and no longer throws at the caller.
		await expect(useTHRAXStore.getState().run()).resolves.toBeUndefined()
		expect(useTHRAXStore.getState().console).toContain('Undefined label: missing')

		useTHRAXStore.getState().setCode('main:\n\tnop\n')
		useTHRAXStore.getState().assemble()
		expect(useTHRAXStore.getState().diagnostics).toEqual([])
	})
})

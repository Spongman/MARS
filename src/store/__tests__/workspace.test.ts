import { describe, expect, it, vi } from 'vitest'
import { Assembler } from '../../core/assembler'

// The download itself needs a document; what it was handed is what matters here.
vi.mock('../../services/hexTextExport', () => ({ downloadHexText: vi.fn() }))

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

const { downloadHexText } = await import('../../services/hexTextExport')
const { useTHRAXStore } = await import('../thraxStore')

const state = () => useTHRAXStore.getState()
const titleOf = (id: string) => state().documents.find((document) => document.id === id)?.title
const titles = () => state().documents.map((document) => document.title)
const isOpen = (id: string) => state().documents.some((document) => document.id === id)

/** Two open files, so a collision or a close has something to happen between. */
const openTwoFiles = (first: string, second: string, dirty = false) => {
	useTHRAXStore.setState({
		documents: [
			{ id: 'one', title: first, code: '', dirty },
			{ id: 'two', title: second, code: '', dirty },
		],
		activeDocumentId: 'one',
		code: '',
	})
}

describe('hex text export', () => {
	it('exports the words the program would actually run', () => {
		// `mulo` puts a NOP in the branch's delay slot only when the setting is on,
		// so its expansion is where the two option sets diverge.
		const code = 'main:\n\tli $t0, 3\n\tli $t1, 4\n\tmulo $t2, $t0, $t1\n'
		state().setCode(code)
		state().setSetting('delayedBranching', true)

		expect(state().exportHexText()).toBe(true)

		const files = [{ name: 'main.asm', code }]
		const delayed = new Assembler(files, ['main.asm'], { delayedBranching: true }).assemble().machineCode
		const undelayed = new Assembler(files, ['main.asm'], { delayedBranching: false }).assemble().machineCode
		expect(delayed).not.toEqual(undelayed)
		expect(vi.mocked(downloadHexText).mock.calls[0][0]).toEqual(delayed)

		state().setSetting('delayedBranching', false)
	})
})

describe('saving', () => {
	it('clears the dirty marks of the files it wrote out', () => {
		state().setCode('# edited\n')
		expect(state().documents.every((document) => document.dirty)).toBe(true)

		expect(state().saveProgram()).toBe(true)
		expect(state().documents.some((document) => document.dirty)).toBe(false)
	})
})

describe('cache settings', () => {
	it('publishes the settings the cache is really using', () => {
		// Associativity beyond the block count is a fully associative cache.
		state().setCacheSettings({ blockCount: 4, blockSizeBytes: 16, associativity: 8, replacement: 'lru' })

		expect(state().cacheSettings.associativity).toBe(4)
		expect(state().cacheSettings).toEqual(state().cache.settings)
	})
})

describe('file titles', () => {
	it('gives a new file a title no open file has', () => {
		openTwoFiles('untitled-3.asm', 'other.asm')
		state().createDocument()

		expect(new Set(titles()).size).toBe(3)
		expect(titleOf(state().activeDocumentId)).toBe('untitled.asm')
	})

	it('renames around a title another file already has', () => {
		openTwoFiles('shared.asm', 'other.asm')
		state().renameDocument('two', 'shared.asm')

		expect(titleOf('one')).toBe('shared.asm')
		expect(titleOf('two')).toBe('shared-2.asm')
	})

	it('leaves a title alone when no other file has it', () => {
		openTwoFiles('shared.asm', 'other.asm')
		state().renameDocument('two', 'renamed.asm')

		expect(titleOf('two')).toBe('renamed.asm')
	})
})

describe('document ids', () => {
	it('gives two files created in the same millisecond different ids', () => {
		// The clock is pinned so the collision is certain rather than a race.
		const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
		openTwoFiles('one.asm', 'two.asm')
		state().createDocument()
		const first = state().activeDocumentId
		state().createDocument()
		const second = state().activeDocumentId
		now.mockRestore()

		expect(first).not.toBe(second)

		// A shared id renamed both files, and dockview then collapsed them.
		state().renameDocument(second, 'renamed.asm')
		expect(titleOf(first)).toBe('untitled.asm')
		expect(titleOf(second)).toBe('renamed.asm')
	})
})

describe('closing a file', () => {
	it('closes a file with nothing unsaved in it', () => {
		openTwoFiles('one.asm', 'two.asm')
		state().requestCloseDocument('two')

		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(false)
	})

	it('asks before discarding an edited file, and keeps it when the answer is no', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().requestCloseDocument('two')

		expect(state().pendingClose).toBe('two')
		expect(isOpen('two')).toBe(true)

		state().cancelCloseDocument()
		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(true)
	})

	it('closes the edited file once the answer is yes', () => {
		openTwoFiles('one.asm', 'two.asm', true)
		state().requestCloseDocument('two')
		state().confirmCloseDocument()

		expect(state().pendingClose).toBe(null)
		expect(isOpen('two')).toBe(false)
	})
})

describe('loading', () => {
	it('separates saved files that share a title', () => {
		storage.set('thrax-web.saved-program', JSON.stringify({
			version: 2,
			code: '# one\n',
			savedAt: '2026-01-01T00:00:00.000Z',
			documents: [
				{ id: 'one', title: 'shared.asm', code: '# one\n', dirty: false },
				{ id: 'two', title: 'shared.asm', code: '# two\n', dirty: false },
			],
			activeDocumentId: 'one',
		}))

		expect(state().loadProgram()).toBe(true)
		expect(titles()).toEqual(['shared.asm', 'shared-2.asm'])
	})
})

import React from 'react'
import { DockviewDefaultTab, DockviewReact, themeDark, type AddPanelOptions, type DockviewApi, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type SerializedDockview } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { useTHRAXStore, type SourceDocument } from '../store/thraxStore'
import SourcePane from './SourcePane'
import RegisterView from './RegisterView'
import MemoryView from './MemoryView'
import ConsoleOutput from './ConsoleOutput'
import CallStackView from './CallStackView'
import BitmapDisplay from './BitmapDisplay'
import KeyboardDisplayTool from './KeyboardDisplayTool'
import InstructionStatisticsView from './InstructionStatisticsView'
import CacheSimulatorView from './CacheSimulatorView'
import BranchHistoryView from './BranchHistoryView'
import MipsXrayView from './MipsXrayView'
import PipelineView from './PipelineView'
import './DockLayout.css'

/** Open files are panels of the main tab group, one editor each. */
const FILE_PREFIX = 'file:'
const filePanelId = (documentId: string) => `${FILE_PREFIX}${documentId}`
const documentIdOf = (panel: IDockviewPanel) => panel.id.slice(FILE_PREFIX.length)
const isFilePanel = (panel: IDockviewPanel) => panel.id.startsWith(FILE_PREFIX)
/** An unsaved file is marked in its tab, which shows the title and nothing else. */
const fileTitle = (document: SourceDocument) => `${document.dirty ? '● ' : ''}${document.title}`

const SourcePanel = (props: IDockviewPanelProps) => (
	<div className="dock-panel dock-panel-flush"><SourcePane documentId={props.params.documentId as string} /></div>
)

const RegistersPanel = () => {
	const { registers, fpRegisters, fpConditionFlags, cp0Registers } = useTHRAXStore()
	return (
		<div className="dock-panel">
			<RegisterView
				registers={registers}
				fpRegisters={fpRegisters}
				fpConditionFlags={fpConditionFlags}
				cp0Registers={cp0Registers}
			/>
		</div>
	)
}

const MemoryPanel = () => {
	const { callStack, memory, pc, selectedFrame, sourceMap, setHoveredAddress } = useTHRAXStore()
	// Mark the program counter only where the editor can highlight it too: once a
	// program halts, the pc sits past the last instruction and belongs to neither.
	const instructionAddresses = React.useMemo(() => new Set(sourceMap.values()), [sourceMap])
	const returnAddresses = React.useMemo(() => new Set(callStack.map((frame) => frame.returnAddress)), [callStack])
	return (
		<div className="dock-panel dock-panel-flush">
			<MemoryView
				memory={memory}
				pc={instructionAddresses.has(pc) ? pc : null}
				returnAddresses={returnAddresses}
				focusAddress={selectedFrame === null ? null : selectedFrame === -1 ? pc : callStack[selectedFrame]?.returnAddress ?? null}
				onHoverAddress={setHoveredAddress}
			/>
		</div>
	)
}

const ConsolePanel = () => {
	const { console: output, pendingInput, submitInput } = useTHRAXStore()
	return <div className="dock-panel dock-panel-flush"><ConsoleOutput output={output} pendingInput={pendingInput} onSubmitInput={submitInput} /></div>
}

const CallStackPanel = () => {
	const { callStack, halted, labels, pc, selectedFrame, setSelectedFrame, sourceMap } = useTHRAXStore()
	return (
		<div className="dock-panel">
			<CallStackView
				frames={callStack}
				pc={pc}
				labels={labels}
				hasProgram={sourceMap.size > 0}
				halted={halted}
				selectedFrame={selectedFrame}
				onSelect={setSelectedFrame}
			/>
		</div>
	)
}

const BitmapPanel = () => {
	const memory = useTHRAXStore((state) => state.memory)
	return <div className="dock-panel"><BitmapDisplay memory={memory} /></div>
}

const KeyboardDisplayPanel = () => {
	const { keyboardDisplay, sendKeyboardInput } = useTHRAXStore()
	return <div className="dock-panel"><KeyboardDisplayTool device={keyboardDisplay} onSend={sendKeyboardInput} /></div>
}

const StatisticsPanel = () => {
	const statistics = useTHRAXStore((state) => state.statistics)
	return <div className="dock-panel"><InstructionStatisticsView statistics={statistics} /></div>
}

const CachePanel = () => {
	const { cache, cacheSettings, setCacheSettings } = useTHRAXStore()
	return <div className="dock-panel"><CacheSimulatorView cache={cache} settings={cacheSettings} onChange={setCacheSettings} /></div>
}

const BranchHistoryPanel = () => {
	const { branchHistory, branchHistorySettings, setBranchHistorySettings } = useTHRAXStore()
	return <div className="dock-panel"><BranchHistoryView branchHistory={branchHistory} settings={branchHistorySettings} onChange={setBranchHistorySettings} /></div>
}

const XrayPanel = () => {
	const { memory, pc } = useTHRAXStore()
	return <div className="dock-panel"><MipsXrayView memory={memory} pc={pc} /></div>
}

const PipelinePanel = () => {
	const { pipeline, pipelineSettings, setPipelineSettings } = useTHRAXStore()
	return <div className="dock-panel"><PipelineView pipeline={pipeline} settings={pipelineSettings} onChange={setPipelineSettings} /></div>
}

/** Carries the console's plea for attention while its tab sits in the background. */
const ConsoleTab = (props: IDockviewPanelHeaderProps) => {
	const attention = useTHRAXStore((state) => state.consoleAttention)
	return <DockviewDefaultTab {...props} className={attention === 'none' ? undefined : `console-tab-${attention}`} />
}

/** Double-clicking a file tab renames it, which `.include` resolves by title. */
const SourceTab = (props: IDockviewPanelHeaderProps) => {
	const documentId = props.params.documentId as string
	const renameDocument = useTHRAXStore((state) => state.renameDocument)
	const handleRename = (event: React.MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		const { documents } = useTHRAXStore.getState()
		const title = documents.find((document) => document.id === documentId)?.title
		if (title === undefined) return
		const renamed = window.prompt('File name', title)
		const trimmed = renamed?.trim()
		if (trimmed && trimmed !== title) renameDocument(documentId, trimmed)
	}
	return <div className="source-tab" onDoubleClick={handleRename}><DockviewDefaultTab {...props} /></div>
}

const tabComponents = { console: ConsoleTab, source: SourceTab }

const components = {
	source: SourcePanel,
	registers: RegistersPanel,
	memory: MemoryPanel,
	console: ConsolePanel,
	callStack: CallStackPanel,
	bitmap: BitmapPanel,
	keyboardDisplay: KeyboardDisplayPanel,
	statistics: StatisticsPanel,
	cache: CachePanel,
	branchHistory: BranchHistoryPanel,
	pipeline: PipelinePanel,
	xray: XrayPanel,
}

const LAYOUT_KEY = 'thrax-web.dock-layout'
/** Bumped when a stored layout can no longer be read; older ones are discarded. */
const LAYOUT_VERSION = 2

/** Tool panels hang off the file panels, which are the main tab group. */
const toolPanels = (anchor: string): AddPanelOptions[] => [
	{ id: 'registers', component: 'registers', title: 'Registers', position: { referencePanel: anchor, direction: 'right' }, initialWidth: 340 },
	{ id: 'callStack', component: 'callStack', title: 'Call Stack', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'bitmap', component: 'bitmap', title: 'Bitmap', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'keyboardDisplay', component: 'keyboardDisplay', title: 'Keyboard / Display', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'statistics', component: 'statistics', title: 'Statistics', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'cache', component: 'cache', title: 'Cache', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'branchHistory', component: 'branchHistory', title: 'Branches', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'memory', component: 'memory', title: 'Memory', position: { referencePanel: anchor, direction: 'below' }, initialHeight: 260 },
	{ id: 'pipeline', component: 'pipeline', title: 'Pipeline', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'xray', component: 'xray', title: 'X-Ray', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'console', component: 'console', title: 'Console', tabComponent: 'console', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
]

/** A stored layout is only usable while every panel in it still has a component. */
function readStoredLayout(): SerializedDockview | null {
	try {
		const raw = window.localStorage.getItem(LAYOUT_KEY)
		if (raw === null) return null
		const stored: unknown = JSON.parse(raw)
		if (typeof stored !== 'object' || stored === null) return null
		const { version, layout } = stored as { version?: unknown, layout?: SerializedDockview }
		if (version !== LAYOUT_VERSION || !layout?.grid || !layout.panels) return null
		const known = Object.values(layout.panels).every((panel) => panel.contentComponent !== undefined && panel.contentComponent in components)
		return known ? layout : null
	} catch {
		// Unreadable storage (private mode, bad JSON) just means the default layout.
		return null
	}
}

function saveLayout(api: DockviewApi) {
	try {
		window.localStorage.setItem(LAYOUT_KEY, JSON.stringify({ version: LAYOUT_VERSION, layout: api.toJSON() }))
	} catch {
		// Storage can be full or blocked; the layout simply is not remembered.
	}
}

/**
 * Brings the file panels in line with the open files: one panel per file, in
 * one tab group, with the titles they currently carry.  A stored layout can
 * name files this session does not have, and files can be opened and closed
 * while it is running, so both directions are reconciled here.
 */
function syncFilePanels(api: DockviewApi, documents: readonly SourceDocument[], removing: Set<string>) {
	const wanted = new Map(documents.map((document) => [filePanelId(document.id), document]))
	for (const panel of api.panels) {
		if (!isFilePanel(panel) || wanted.has(panel.id)) continue
		// Removing a panel ourselves must not read back as the user closing a file.
		removing.add(panel.id)
		api.removePanel(panel)
	}

	let anchor = api.panels.find(isFilePanel)
	for (const [id, document] of wanted) {
		const existing = api.getPanel(id)
		if (existing) {
			if (existing.title !== fileTitle(document)) existing.api.setTitle(fileTitle(document))
			continue
		}
		const panel = api.addPanel({
			id,
			component: 'source',
			tabComponent: 'source',
			title: fileTitle(document),
			params: { documentId: document.id },
			...(anchor ? { position: { referencePanel: anchor.id, direction: 'within' as const } } : {}),
			inactive: true,
		})
		anchor ??= panel
	}
	return anchor
}

/**
 * Restores the stored arrangement, then adds back any panel it is missing so a
 * panel added by a later release still appears beside the ones it belongs with.
 */
function buildLayout(api: DockviewApi, removing: Set<string>) {
	const stored = readStoredLayout()
	if (stored) {
		try {
			api.fromJSON(stored)
		} catch {
			api.clear()
		}
	}
	const restored = api.panels.length > 0
	const { activeDocumentId, documents } = useTHRAXStore.getState()
	const anchor = syncFilePanels(api, documents, removing)

	for (const options of toolPanels(anchor?.id ?? '')) {
		if (api.getPanel(options.id)) continue
		const reference = options.position && 'referencePanel' in options.position ? options.position.referencePanel : undefined
		if (!restored || (typeof reference === 'string' && api.getPanel(reference))) {
			api.addPanel(options)
			continue
		}
		// Its usual neighbour is gone, so it joins whichever group is in front.
		const { position, ...loose } = options
		api.addPanel({ ...loose, inactive: true })
	}
	api.getPanel(filePanelId(activeDocumentId))?.api.setActive()
}

function DockLayout() {
	const apiRef = React.useRef<DockviewApi | null>(null)
	const { activeDocumentId, console: output, consoleAttention, documents, pendingInput, runToken, setConsoleAttention } = useTHRAXStore()
	const switchedForRun = React.useRef<number | null>(null)
	const deliveredOutput = React.useRef('')
	/** File panels this component is removing, which are not files being closed. */
	const removingPanels = React.useRef(new Set<string>())
	const shownDocument = React.useRef<string | null>(null)

	const saveHandle = React.useRef(0)
	const subscriptions = React.useRef<{ dispose: () => void }[]>([])

	const onReady = React.useCallback((event: DockviewReadyEvent) => {
		apiRef.current = event.api
		buildLayout(event.api, removingPanels.current)
		shownDocument.current = useTHRAXStore.getState().activeDocumentId

		// Bringing a file's tab forward makes it the file being assembled.
		subscriptions.current.push(event.api.onDidActivePanelChange(({ panel }) => {
			if (!panel || !isFilePanel(panel)) return
			shownDocument.current = documentIdOf(panel)
			useTHRAXStore.getState().selectDocument(documentIdOf(panel))
		}))

		// Dockview also removes a panel to move it, so a file is closed only once
		// the panel has not come back by the end of the move.
		subscriptions.current.push(event.api.onDidRemovePanel((panel) => {
			if (!isFilePanel(panel)) return
			const { id } = panel
			window.setTimeout(() => {
				if (removingPanels.current.delete(id) || apiRef.current?.getPanel(id)) return
				useTHRAXStore.getState().closeDocument(documentIdOf(panel))
			}, 0)
		}))
		// Dragging and resizing fire in bursts, so the layout is written once things settle.
		subscriptions.current.push(event.api.onDidLayoutChange(() => {
			window.clearTimeout(saveHandle.current)
			saveHandle.current = window.setTimeout(() => saveLayout(event.api), 300)
		}))
		// Showing the console answers whatever it was asking for.
		const console = event.api.getPanel('console')
		if (console) {
			subscriptions.current.push(console.api.onDidActiveChange((change) => {
				if (change.isActive) useTHRAXStore.getState().setConsoleAttention('none')
			}))
		}
	}, [])

	React.useEffect(() => () => {
		window.clearTimeout(saveHandle.current)
		for (const subscription of subscriptions.current) subscription.dispose()
		subscriptions.current = []
	}, [])

	// One panel per open file, kept in step as files are opened, renamed and closed.
	React.useEffect(() => {
		const api = apiRef.current
		if (!api) return
		syncFilePanels(api, documents, removingPanels.current)
		// Only a change of file moves the tabs, so running a program leaves
		// whichever panel the user is looking at in front.
		if (shownDocument.current === activeDocumentId) return
		shownDocument.current = activeDocumentId
		api.getPanel(filePanelId(activeDocumentId))?.api.setActive()
	}, [activeDocumentId, documents])

	// The first console traffic of a run brings the panel forward; later traffic
	// only flashes the tab, and a request for input keeps flashing until it shows.
	React.useEffect(() => {
		const panel = apiRef.current?.getPanel('console')
		if (!panel) return
		// A run starts with an empty console, so what came before it means nothing.
		const newRun = switchedForRun.current !== runToken
		if (newRun) deliveredOutput.current = ''
		const grew = output.length > deliveredOutput.current.length
		deliveredOutput.current = output
		if (!grew && !pendingInput) return
		if (panel.api.isActive) {
			setConsoleAttention('none')
			return
		}
		if (newRun) {
			switchedForRun.current = runToken
			panel.api.setActive()
			setConsoleAttention('none')
			return
		}
		setConsoleAttention(pendingInput ? 'input' : 'output')
	}, [output, pendingInput, runToken, setConsoleAttention])

	// One flash for output; input keeps flashing, so it has no timer.
	React.useEffect(() => {
		if (consoleAttention !== 'output') return
		const handle = window.setTimeout(() => setConsoleAttention('none'), 1200)
		return () => window.clearTimeout(handle)
	}, [consoleAttention, setConsoleAttention])

	return <DockviewReact className="dock-layout" components={components} tabComponents={tabComponents} theme={themeDark} onReady={onReady} />
}

export default DockLayout

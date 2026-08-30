import React from 'react'
import { DockviewDefaultTab, DockviewReact, themeDark, type AddPanelOptions, type DockviewApi, type DockviewReadyEvent, type IDockviewPanel, type IDockviewPanelHeaderProps, type IDockviewPanelProps, type SerializedDockview } from 'dockview-react'
import 'dockview-react/dist/styles/dockview.css'
import { CP0_REGISTERS } from '../core/coprocessor'
import { visibleAddresses } from '../debug/session'
import { useTHRAXStore, type SourceDocument } from '../store/thraxStore'
import SourcePane from './SourcePane'
import RegisterView from './RegisterView'
import MemoryView from './MemoryView'
import ConsoleOutput from './ConsoleOutput'
import CallStackView from './CallStackView'
import BitmapDisplay from './BitmapDisplay'
import KeyboardDisplayTool from './KeyboardDisplayTool'
import InstructionStatisticsView from './InstructionStatisticsView'
import IntroToToolsView from './IntroToToolsView'
import CacheSimulatorView from './CacheSimulatorView'
import BranchHistoryView from './BranchHistoryView'
import MarsBotView from './MarsBotView'
import MemoryReferenceView from './MemoryReferenceView'
import MipsXrayView from './MipsXrayView'
import Modal from './Modal'
import PipelineView from './PipelineView'
import ScavengerHuntView from './ScavengerHuntView'
import ScreenMagnifierView from './ScreenMagnifierView'
import { HistoryPanel } from './HistoryView'
import { SymbolTablePanel } from './SymbolTableView'
import DigitalLabView from './DigitalLabView'
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
	const { registers, fpRegisters, fpConditionFlags, cp0Registers, halted, isPaused, isRunning, setRegisterValue, setFpRegisterValue, setCp0RegisterValue } = useTHRAXStore()
	// Only while the machine is stopped, and only once it has one to edit.
	const editable = !isRunning && (isPaused || halted)

	const handleEdit = React.useCallback((entry: { name: string }, bits: number, high?: number) => {
		const name = entry.name
		if (name.startsWith('$f')) {
			const index = Number(name.slice(2))
			const low = setFpRegisterValue(index, bits)
			// A double occupies the register and its odd partner.
			return high === undefined ? low : low && setFpRegisterValue(index + 1, high)
		}
		const cp0 = CP0_REGISTERS.find((register) => register.name === name)
		if (cp0) return setCp0RegisterValue(cp0.index, bits)
		return setRegisterValue(name, bits | 0)
	}, [setCp0RegisterValue, setFpRegisterValue, setRegisterValue])
	return (
		<div className="dock-panel">
			<RegisterView
				registers={registers}
				editable={editable}
				onEdit={handleEdit}
				fpRegisters={fpRegisters}
				fpConditionFlags={fpConditionFlags}
				cp0Registers={cp0Registers}
			/>
		</div>
	)
}

const MemoryPanel = () => {
	const { callStack, focusedMemory, halted, isPaused, isRunning, memory, pc, selectedFrame, setMemoryValue, sourceIndex, setHoveredAddress } = useTHRAXStore()
	const editable = !isRunning && (isPaused || halted)
	// Mark the program counter only where the editor can highlight it too: once a
	// program halts, the pc sits past the last instruction and belongs to neither.
	const instructionAddresses = React.useMemo(() => visibleAddresses(sourceIndex), [sourceIndex])
	const returnAddresses = React.useMemo(() => new Set(callStack.map((frame) => frame.returnAddress)), [callStack])
	return (
		<div className="dock-panel dock-panel-flush">
			<MemoryView
				memory={memory}
				pc={instructionAddresses.has(pc) ? pc : null}
				returnAddresses={returnAddresses}
				// A panel asking for an address wins over the selected call frame,
				// since it is the more recent thing the user did.
				focusAddress={focusedMemory?.address ?? (selectedFrame === null ? null : selectedFrame === -1 ? pc : callStack[selectedFrame]?.returnAddress ?? null)}
				focusRequest={focusedMemory?.request ?? 0}
				onHoverAddress={setHoveredAddress}
				editable={editable}
				onEditWord={setMemoryValue}
			/>
		</div>
	)
}

const ConsolePanel = () => {
	const { console: output, pendingInput, submitInput } = useTHRAXStore()
	return <div className="dock-panel dock-panel-flush"><ConsoleOutput output={output} pendingInput={pendingInput} onSubmitInput={submitInput} /></div>
}

const CallStackPanel = () => {
	const { callStack, halted, labels, pc, selectedFrame, setSelectedFrame, sourceIndex } = useTHRAXStore()
	// Any assembled file having code means there is a program to have a stack.
	const hasProgram = React.useMemo(() => [...sourceIndex.files()].some((file) => sourceIndex.hasCode(file)), [sourceIndex])
	return (
		<div className="dock-panel">
			<CallStackView
				frames={callStack}
				pc={pc}
				labels={labels}
				hasProgram={hasProgram}
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

const MemoryReferencePanel = () => {
	const { memoryReference, memoryReferenceSettings, setMemoryReferenceSettings } = useTHRAXStore()
	return <div className="dock-panel"><MemoryReferenceView memoryReference={memoryReference} settings={memoryReferenceSettings} onChange={setMemoryReferenceSettings} /></div>
}

const MarsBotPanel = () => {
	const marsBot = useTHRAXStore((state) => state.marsBot)
	return <div className="dock-panel"><MarsBotView marsBot={marsBot} /></div>
}

const DigitalLabPanel = () => {
	const digitalLab = useTHRAXStore((state) => state.digitalLab)
	const pressKey = useTHRAXStore((state) => state.pressDigitalLabKey)
	return <div className="dock-panel"><DigitalLabView state={digitalLab} onPressKey={pressKey} /></div>
}

const ScavengerHuntPanel = () => {
	const scavengerHunt = useTHRAXStore((state) => state.scavengerHunt)
	return <div className="dock-panel"><ScavengerHuntView scavengerHunt={scavengerHunt} /></div>
}

// The magnifier lenses the workspace and the introduction is prose, so neither
// watches a run and neither has a tool behind it.
const ScreenMagnifierPanel = () => <div className="dock-panel"><ScreenMagnifierView /></div>

const IntroToToolsPanel = () => <div className="dock-panel"><IntroToToolsView /></div>

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
	history: HistoryPanel,
	symbols: SymbolTablePanel,
	registers: RegistersPanel,
	memory: MemoryPanel,
	console: ConsolePanel,
	callStack: CallStackPanel,
	bitmap: BitmapPanel,
	keyboardDisplay: KeyboardDisplayPanel,
	statistics: StatisticsPanel,
	cache: CachePanel,
	branchHistory: BranchHistoryPanel,
	memoryReference: MemoryReferencePanel,
	marsBot: MarsBotPanel,
	scavengerHunt: ScavengerHuntPanel,
	digitalLab: DigitalLabPanel,
	screenMagnifier: ScreenMagnifierPanel,
	introToTools: IntroToToolsPanel,
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
	{ id: 'symbols', component: 'symbols', title: 'Symbols', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'bitmap', component: 'bitmap', title: 'Bitmap', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'keyboardDisplay', component: 'keyboardDisplay', title: 'Keyboard / Display', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'statistics', component: 'statistics', title: 'Statistics', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'cache', component: 'cache', title: 'Cache', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'branchHistory', component: 'branchHistory', title: 'Branches', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'memoryReference', component: 'memoryReference', title: 'Memory Reference', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'screenMagnifier', component: 'screenMagnifier', title: 'Magnifier', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'introToTools', component: 'introToTools', title: 'About Tools', position: { referencePanel: 'registers', direction: 'within' }, inactive: true },
	{ id: 'memory', component: 'memory', title: 'Memory', position: { referencePanel: anchor, direction: 'below' }, initialHeight: 260 },
	{ id: 'history', component: 'history', title: 'History', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'pipeline', component: 'pipeline', title: 'Pipeline', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'xray', component: 'xray', title: 'X-Ray', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	// The two device panels draw a world, so they sit in the wide group.
	{ id: 'marsBot', component: 'marsBot', title: 'Mars Bot', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'scavengerHunt', component: 'scavengerHunt', title: 'Scavenger Hunt', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
	{ id: 'digitalLab', component: 'digitalLab', title: 'Digital Lab', position: { referencePanel: 'memory', direction: 'within' }, inactive: true },
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
export function buildLayout(api: DockviewApi, removing: Set<string>) {
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
	const { activeDocumentId, cancelCloseDocument, confirmCloseDocument, console: output, consoleAttention, documents, pendingClose, pendingInput, runToken, setConsoleAttention } = useTHRAXStore()
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
				useTHRAXStore.getState().requestCloseDocument(documentIdOf(panel))
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

	const pending = documents.find((document) => document.id === pendingClose)

	// Dockview removed the panel before the store was asked, so keeping the file
	// means putting its panel back where it was.
	const keepDocument = () => {
		const id = pending?.id
		cancelCloseDocument()
		const api = apiRef.current
		if (!api || !id) return
		syncFilePanels(api, useTHRAXStore.getState().documents, removingPanels.current)
		api.getPanel(filePanelId(id))?.api.setActive()
	}

	return (
		<>
			<DockviewReact className="dock-layout" components={components} tabComponents={tabComponents} theme={themeDark} onReady={onReady} />
			{pending && (
				<Modal
					title="Unsaved changes"
					onClose={keepDocument}
					footer={(
						<>
							<button className="btn btn-secondary" onClick={keepDocument}>Keep editing</button>
							<button className="btn btn-primary" onClick={confirmCloseDocument}>Close without saving</button>
						</>
					)}
				>
					{`${pending.title} has changes that were never saved.`}
				</Modal>
			)}
		</>
	)
}

export default DockLayout

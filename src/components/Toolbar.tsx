import React from 'react'
import { DEFAULT_GUTTER_COLUMNS, RUN_SPEEDS, useTHRAXStore } from '../store/thraxStore'
import { AddressIcon, CodeBytesIcon, DisassemblyIcon, HeatLinesIcon, HeatMapIcon } from './icons'
import { nextToggles } from './toggleGroup'
import MainMenu from './MainMenu'
import SettingsDialog from './SettingsDialog'
import { openPanel } from './DockLayout'
import { openFindReplace } from '../services/findReplace'
import './Toolbar.css'

interface ToolbarProps {
	onRun: () => Promise<void>
	onReset: () => void
}

/**
 * The toolbar carries what a run is driven with, left to right in the order it
 * is used: assemble, run, step, pace.  What is chosen once a session lives in
 * the menu, and what belongs to the file sits on the right.
 */
function Toolbar({ onRun, onReset }: ToolbarProps) {
	const { assemble, continue: continueExecution, createDocument, exportHexText, gutterColumns, hasSavedProgram, heatMap, heatMapLines, isPaused, isRunning, loadProgram, openPanels, pause, runSpeed, saveProgram, setGutterColumns, setHeatMap, setHeatMapLines, setRunSpeed, step, stepBack, stepOver, stepToReturn } = useTHRAXStore()
	const [showSettings, setShowSettings] = React.useState(false)
	const [storageMessage, setStorageMessage] = React.useState<string | null>(null)

	const handleLoadExample = (code: string) => {
		window.dispatchEvent(new CustomEvent('load-example', { detail: { code } }))
	}

	const showStorageMessage = (message: string) => {
		setStorageMessage(message)
		window.setTimeout(() => setStorageMessage(null), 2500)
	}

	const handleSave = () => {
		showStorageMessage(saveProgram() ? 'Workspace saved in this browser' : 'Unable to save workspace')
	}

	const handleLoad = () => {
		if (!window.confirm('Replace the current workspace with the saved workspace?')) return
		showStorageMessage(loadProgram() ? 'Saved workspace loaded' : 'No saved workspace is available')
	}

	const handleExport = () => {
		showStorageMessage(exportHexText() ? 'Downloaded HexText' : 'Unable to assemble HexText')
	}

	// The slider steps through the speed list, with the fastest notch unpaced.
	const speedIndex = Math.max(0, RUN_SPEEDS.indexOf(runSpeed))
	const speedLabel = runSpeed === null
		? 'no limit'
		: runSpeed < 1000 ? `${runSpeed}/s` : `${runSpeed / 1000}k/s`

	return (
		<div className="toolbar">
			<MainMenu
				onSettings={() => setShowSettings(true)}
				onLoadExample={handleLoadExample}
				onOpenPanel={openPanel}
				openPanels={openPanels}
			/>

			<span className="toolbar-separator" />

			<button className="btn btn-secondary" onClick={assemble} title="Assemble the current source">
				Assemble
			</button>

			<div className="btn-group">
				<button className="btn btn-icon btn-primary" onClick={() => (isPaused ? void continueExecution() : void onRun())} title={isPaused ? 'Continue (F5)' : 'Run (F5)'}>
					▶
				</button>
				<button className="btn btn-icon" onClick={pause} disabled={!isRunning} title="Pause">
					⏸
				</button>
				<button className="btn btn-icon" onClick={onReset} title="Reset (alt+F5), restart with shift+F5">
					↺
				</button>
			</div>

			<div className="btn-group">
				<button className="btn btn-icon" onClick={() => stepBack()} disabled={!isPaused} title="Step back">
					↶
				</button>
				<button className="btn btn-icon" onClick={() => step()} title="Step into (F8)">
					⤷
				</button>
				<button className="btn btn-icon" onClick={() => void stepOver()} title="Step over (F10)">
					↷
				</button>
				<button className="btn btn-icon" onClick={() => void stepToReturn()} title="Step out (shift+F7)">
					⤴
				</button>
			</div>

			<label className="toolbar-speed" title="Instructions per second while running; the rightmost notch runs at full speed">
				<span className="toolbar-speed-icon" aria-hidden="true">🐢</span>
				<input
					type="range"
					min={0}
					max={RUN_SPEEDS.length - 1}
					step={1}
					value={speedIndex}
					onChange={(event) => setRunSpeed(RUN_SPEEDS[Number(event.target.value)])}
					aria-label="Run speed"
				/>
				<span className="toolbar-speed-value">{speedLabel}</span>
			</label>

			<span className="toolbar-separator" />

			<div className="gutter-toggles" role="group" aria-label="Gutter columns">
				<button
					className={`gutter-toggle${gutterColumns.address ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.address}
					title="Address: show the address of each machine word"
					aria-label="Address"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'address', event))}
				>
					<AddressIcon />
				</button>
				<button
					className={`gutter-toggle${gutterColumns.code ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.code}
					title="Code bytes: show each machine word beside its source line"
					aria-label="Code bytes"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'code', event))}
				>
					<CodeBytesIcon />
				</button>
				<button
					className={`gutter-toggle${gutterColumns.disassembly ? ' active' : ''}`}
					type="button"
					aria-pressed={gutterColumns.disassembly}
					title="Disassembly: show the decoded instruction beside its source line"
					aria-label="Disassembly"
					onClick={(event) => setGutterColumns(nextToggles({ ...DEFAULT_GUTTER_COLUMNS, ...gutterColumns }, 'disassembly', event))}
				>
					<DisassemblyIcon />
				</button>
			</div>

			<div className="gutter-toggles" role="group" aria-label="Profile heat map">
				<button
					className={`gutter-toggle${heatMap ? ' active' : ''}`}
					type="button"
					aria-pressed={heatMap}
					title="Profile heat map: colour each line number by how often the line ran"
					aria-label="Profile heat map"
					onClick={() => setHeatMap(!heatMap)}
				>
					<HeatMapIcon />
				</button>
				<button
					className={`gutter-toggle${heatMap && heatMapLines ? ' active' : ''}`}
					type="button"
					aria-pressed={heatMapLines}
					disabled={!heatMap}
					title="Tint the source line behind the code with its heat as well"
					aria-label="Heat map line tint"
					onClick={() => setHeatMapLines(!heatMapLines)}
				>
					<HeatLinesIcon />
				</button>
			</div>

			<div className="spacer"></div>

			{storageMessage && <span className="storage-message" role="status">{storageMessage}</span>}

			<button className="btn btn-secondary" onClick={openFindReplace} title="Find and replace in the source being assembled">
				Find
			</button>

			<span className="toolbar-separator" />

			<button className="btn btn-icon" onClick={createDocument} title="New file">
				+
			</button>
			<button className="btn btn-secondary" onClick={handleSave} title="Save open source tabs in this browser">
				Save
			</button>
			<button className="btn btn-secondary" onClick={handleLoad} disabled={!hasSavedProgram} title="Load saved source tabs">
				Load
			</button>
			<button className="btn btn-secondary" onClick={handleExport} title="Download HexText">
				Hex
			</button>

			{showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
		</div>
	)
}

export default Toolbar

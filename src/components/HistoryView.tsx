import React from 'react'
import './HistoryView.css'
import { disassemble } from '../core/disassembler'
import { formatWord } from '../core/format'
import type { EffectStore } from '../core/effectStore'
import type { HistoryLog } from '../core/historyLog'
import type { Effect, HistoryEntry } from '../core/types'
import { useTHRAXStore } from '../store/thraxStore'

const ROW_HEIGHT = 20
const OVERSCAN_ROWS = 8

/**
 * What one effect did, as the panel words it.  An effect holds the value that
 * is not in the machine, so which side of the present it is on decides whether
 * that reads as the old value or the new one.
 */
export function describeEffect(effect: Effect, applied: boolean): { label: string, address?: number } {
	const arrow = (held: string) => (applied ? `→ ${held}` : `${held} →`)
	switch (effect.kind) {
		case 'register': return { label: `${effect.name} ${arrow(hex(effect.value))}` }
		case 'fp': return { label: `$f${effect.index} ${arrow(hex(effect.value))}` }
		case 'flag': return { label: `cc${effect.index} ${arrow(String(effect.value))}` }
		case 'cp0': return { label: `cp0[${effect.index}] ${arrow(hex(effect.value))}` }
		case 'memory': {
			const address = effect.wordAddress << 2
			const span = effect.words.length === 1 ? formatWord(address) : `${formatWord(address)}+${effect.words.length * 4}`
			return { label: `[${span}]`, address }
		}
		case 'console': return { label: `console ${JSON.stringify(effect.text)}` }
		case 'consoleReset': return { label: 'console cleared' }
		case 'display': return { label: 'display' }
		case 'queuedInput': return { label: 'keyboard read' }
		case 'call': return { label: `call ${formatWord(effect.frame.targetAddress)}`, address: effect.frame.targetAddress }
		case 'hiLo': return { label: `hi/lo ${arrow(`${hex(effect.hi)}/${hex(effect.lo)}`)}` }
		case 'heapPointer': return { label: `heap ${arrow(hex(effect.value))}` }
		case 'halted': return { label: effect.value ? 'running' : 'halted' }
		case 'exitCode': return { label: 'exit code' }
		case 'sleep': return { label: 'sleep' }
		case 'input': return { label: `read ${JSON.stringify(effect.value)}` }
	}
}

const hex = (value: number) => formatWord(value >>> 0)

/**
 * The effects worth a chip on the row, in the order they happened.  They live
 * in columns, so an object is built only for the rows actually on screen.
 */
export function rowEffects(entry: HistoryEntry, effects: EffectStore, applied: boolean) {
	return Array.from({ length: entry.effectCount }, (unused, offset) =>
		describeEffect(effects.materialize(entry.effectStart + offset), applied))
}

interface HistoryViewProps {
	entries: HistoryLog
	/** How many entries stand behind the present; the rest are ahead of it. */
	cursor: number
	/** Bumped whenever the log changes, since it is written in place. */
	version: number
	sourceOf: (entry: HistoryEntry) => { file: string, line: number, text?: string } | null
	onSelect: (entry: HistoryEntry) => void
	onSetNow: (entry: HistoryEntry) => void
	onSelectAddress: (address: number) => void
	selectedId: number | null
	/** The columns every entry's effects are read out of. */
	effects: EffectStore
}

function HistoryView({ entries, cursor, version, sourceOf, onSelect, onSetNow, onSelectAddress, selectedId, effects }: HistoryViewProps) {
	const scrollRef = React.useRef<HTMLDivElement>(null)
	const [scrollTop, setScrollTop] = React.useState(0)
	const [height, setHeight] = React.useState(0)
	const [following, setFollowing] = React.useState(true)

	React.useEffect(() => {
		const element = scrollRef.current
		if (!element) return
		const observer = new ResizeObserver(() => setHeight(element.clientHeight))
		observer.observe(element)
		setHeight(element.clientHeight)
		return () => observer.disconnect()
	}, [])

	// The list follows the tail while a program runs, until the user scrolls off it.
	React.useEffect(() => {
		const element = scrollRef.current
		if (!element || !following) return
		element.scrollTop = element.scrollHeight
	}, [version, following])

	const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget
		setScrollTop(element.scrollTop)
		const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT
		setFollowing(atEnd)
	}

	const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
	const visible = Math.ceil(height / ROW_HEIGHT) + OVERSCAN_ROWS * 2
	const rows = entries.slice(first, first + visible)

	if (entries.length === 0) {
		return <div className="history-view"><div className="history-empty">Step or run a program to fill the history.</div></div>
	}

	return (
		<div className="history-view">
			<div className="history-scroll" ref={scrollRef} onScroll={handleScroll}>
				<div className="history-spacer" style={{ height: entries.length * ROW_HEIGHT }}>
					<div className="history-rows" style={{ transform: `translateY(${first * ROW_HEIGHT}px)` }}>
						{rows.map((entry, offset) => {
							const index = first + offset
							const ahead = index >= cursor
							const source = sourceOf(entry)
							return (
								<div
									key={entry.id}
									className={`history-row${ahead ? ' ahead' : ''}${entry.id === selectedId ? ' selected' : ''}${entry.kind === 'edit' ? ' edit' : ''}`}
									style={{ height: ROW_HEIGHT }}
									onClick={() => onSelect(entry)}
									onDoubleClick={() => onSetNow(entry)}
									title={ahead ? 'Ahead of the present; double-click to run forward to here' : 'Double-click to step back to here'}
								>
									<span className="history-count">{entry.kind === 'edit' ? 'edit' : entry.instructionCount}</span>
									<button
										type="button"
										className="history-address"
										onClick={(event) => {
											event.stopPropagation()
											onSelectAddress(entry.address)
										}}
									>
										{formatWord(entry.address)}
									</button>
									<span className="history-source">{source ? `${source.file}:${source.line}` : ''}</span>
									<span className="history-instruction">
										{entry.kind === 'edit' ? 'edited by hand' : entry.word === null ? '' : disassemble(entry.word)}
									</span>
									<span className="history-effects">
										{rowEffects(entry, effects, ahead).map((described, chip) => (
											<button
												key={chip}
												type="button"
												className="history-chip"
												onClick={(event) => {
													event.stopPropagation()
													if (described.address !== undefined) onSelectAddress(described.address)
												}}
											>
												{described.label}
											</button>
										))}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			</div>
		</div>
	)
}

/** The history of the program the workspace is running. */
export function HistoryPanel() {
	const { executionHistory, historyCursor, historyEffects, historyVersion, sourceIndex, focusMemoryAddress, rewindTo, step } = useTHRAXStore()
	const [selectedId, setSelectedId] = React.useState<number | null>(null)

	const sourceOf = React.useCallback((entry: HistoryEntry) => sourceIndex.lineForAddress(entry.address), [sourceIndex])

	const setNow = React.useCallback((entry: HistoryEntry) => {
		const index = executionHistory.indexOfId(entry.id)
		if (index < 0) return
		// Behind the present it is a rewind; ahead of it, running forward again.
		if (index < historyCursor) rewindTo(entry.id)
		else for (let count = historyCursor; count <= index; count++) step()
	}, [executionHistory, historyCursor, rewindTo, step])

	return (
		<HistoryView
			entries={executionHistory}
			effects={historyEffects}
			cursor={historyCursor}
			version={historyVersion}
			sourceOf={sourceOf}
			selectedId={selectedId}
			onSelect={(entry) => setSelectedId(entry.id)}
			onSetNow={setNow}
			onSelectAddress={focusMemoryAddress}
		/>
	)
}

export default HistoryView

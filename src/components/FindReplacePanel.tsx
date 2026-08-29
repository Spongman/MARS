import React from 'react'
import { useStoredState } from '../hooks/useStoredState'
import './FindReplacePanel.css'

export interface FindMatch {
	start: number
	end: number
}

interface FindReplacePanelProps {
	code: string
	onChange: (code: string) => void
	/** Lets an editor host reveal and select the active match. */
	onMatchChange?: (match: FindMatch | null) => void
	onClose?: () => void
}

function findMatches(code: string, query: string, caseSensitive: boolean): FindMatch[] {
	if (!query) return []

	const source = caseSensitive ? code : code.toLocaleLowerCase()
	const needle = caseSensitive ? query : query.toLocaleLowerCase()
	const matches: FindMatch[] = []
	let start = 0
	while (start <= source.length - needle.length) {
		const index = source.indexOf(needle, start)
		if (index === -1) break
		matches.push({ start: index, end: index + query.length })
		start = index + Math.max(query.length, 1)
	}
	return matches
}

function FindReplacePanel({ code, onChange, onMatchChange, onClose }: FindReplacePanelProps) {
	const [query, setQuery] = React.useState('')
	const [replacement, setReplacement] = React.useState('')
	const [caseSensitive, setCaseSensitive] = useStoredState('find.caseSensitive', false, (value) => typeof value === 'boolean')
	const [activeIndex, setActiveIndex] = React.useState(0)
	const searchInputRef = React.useRef<HTMLInputElement>(null)

	const matches = React.useMemo(() => findMatches(code, query, caseSensitive), [caseSensitive, code, query])
	const activeMatch = matches.length ? matches[activeIndex % matches.length] : null

	React.useEffect(() => {
		setActiveIndex((index) => matches.length ? index % matches.length : 0)
	}, [matches.length])

	React.useEffect(() => {
		onMatchChange?.(activeMatch)
	}, [activeMatch, onMatchChange])

	React.useEffect(() => {
		searchInputRef.current?.focus()
	}, [])

	const moveMatch = (direction: 1 | -1) => {
		if (!matches.length) return
		setActiveIndex((index) => (index + direction + matches.length) % matches.length)
	}

	const replaceCurrent = () => {
		if (!activeMatch) return
		onChange(`${code.slice(0, activeMatch.start)}${replacement}${code.slice(activeMatch.end)}`)
	}

	const replaceAll = () => {
		if (!matches.length) return
		let offset = 0
		let result = code
		for (const match of matches) {
			const start = match.start + offset
			const end = match.end + offset
			result = `${result.slice(0, start)}${replacement}${result.slice(end)}`
			offset += replacement.length - (match.end - match.start)
		}
		onChange(result)
	}

	return (
		<section className="find-replace-panel" aria-label="Find and replace">
			<div className="find-replace-fields">
				<label className="find-replace-field">
					<span>Find</span>
					<input
						ref={searchInputRef}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value)
							setActiveIndex(0)
						}}
						onKeyDown={(event) => {
							if (event.key === 'Enter') moveMatch(event.shiftKey ? -1 : 1)
							if (event.key === 'Escape') onClose?.()
						}}
						placeholder="Find"
					/>
				</label>
				<label className="find-replace-field">
					<span>Replace</span>
					<input value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Replace with" />
				</label>
			</div>
			<div className="find-replace-actions">
				<label className="find-replace-case">
					<input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
					Match case
				</label>
				<span className="find-replace-count" aria-live="polite">
					{matches.length ? `${activeIndex + 1} of ${matches.length}` : 'No matches'}
				</span>
				<button type="button" onClick={() => moveMatch(-1)} disabled={!matches.length} aria-label="Previous match">↑</button>
				<button type="button" onClick={() => moveMatch(1)} disabled={!matches.length} aria-label="Next match">↓</button>
				<button type="button" onClick={replaceCurrent} disabled={!activeMatch}>Replace</button>
				<button type="button" onClick={replaceAll} disabled={!matches.length}>Replace all</button>
				{onClose && <button type="button" className="find-replace-close" onClick={onClose} aria-label="Close find and replace">×</button>}
			</div>
		</section>
	)
}

export default FindReplacePanel

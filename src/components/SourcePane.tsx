import React from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { EMPTY_SOURCE_INDEX } from '../core/sourceIndex'
import type { CodeWord } from '../core/types'
import { formatHex, formatWord, formatWordDigits } from '../core/format'
import { disassemble, disassembleData } from '../core/disassembler'
import { useTHRAXStore } from '../store/thraxStore'
import { registerMipsDebugDataTips } from '../services/debugDataTips'
import { setFindReplaceEditor } from '../services/findReplace'
import { heatLevel } from '../tools/profile'
import './SourcePane.css'

/** Gutter columns are separated, and closed off, by two spaces. */
const COLUMN_GAP = '  '

/** Only the file being assembled has machine words and a program counter. */
const NO_CODE_WORDS = new Map<number, CodeWord[]>()
const NO_LINES = new Set<number>()

/**
 * Data tips read the live store, so one provider serves every open editor: a
 * second registration would answer the same hover twice.
 */
let dataTipsRegistered = false

const formatAddress = formatWord

const formatCodeWord = (row: CodeWord) => row.word === null
	? row.bytes.map((byte) => formatHex(byte, 2)).join(' ') + (row.truncated ? ' …' : '')
	: formatWordDigits(row.word)

interface SourcePaneProps {
	/** The open file this editor is showing. */
	documentId: string
}

function SourcePane({ documentId }: SourcePaneProps) {
	const store = useTHRAXStore()
	const { activeDocumentId, branchHistory, breakpoints, callStack, documents, gutterColumns, heatMap: showHeatMap, heatMapLines: showHeatLines, hoveredAddress, pipeline, profile, selectedFrame, setBreakpointLines, setDocumentCode, toggleBreakpointAddress, toggleBreakpointLine } = store
	// Everything the debugger marks up belongs to the file being assembled, so
	// the other editors show their own text and none of its decorations.
	const isEntryFile = documentId === activeDocumentId
	const sourceDocument = documents.find((candidate) => candidate.id === documentId)
	const code = sourceDocument?.code ?? ''
	const title = sourceDocument?.title ?? ''
	// A diagnostic names the file it came from; an unnamed one belongs to the
	// file being assembled, which is the only one the assembler was given.
	const diagnostics = React.useMemo(
		() => store.diagnostics.filter((diagnostic) => diagnostic.file ? diagnostic.file === title : isEntryFile),
		[store.diagnostics, isEntryFile, title],
	)
	const codeWords = isEntryFile ? store.codeWords : NO_CODE_WORDS
	// Queried for this file alone, so the other editors resolve nothing.
	const sourceIndex = isEntryFile ? store.sourceIndex : EMPTY_SOURCE_INDEX
	const breakpointLines = isEntryFile ? store.breakpointLines : NO_LINES
	const pc = isEntryFile ? store.pc : -1
	const { address: showAddresses, code: showCodeBytes, disassembly: showDisassembly } = gutterColumns
	const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null)
	const monacoRef = React.useRef<Parameters<OnMount>[1] | null>(null)
	const breakpointDecorationIds = React.useRef<string[]>([])
	const executionDecorationIds = React.useRef<string[]>([])
	const hoverDecorationIds = React.useRef<string[]>([])
	const frameDecorationIds = React.useRef<string[]>([])
	const revealedFrameRef = React.useRef<number | null>(null)
	const codeWordDecorationIds = React.useRef<string[]>([])
	const profileDecorationIds = React.useRef<string[]>([])
	const codeWordZoneIds = React.useRef<string[]>([])
	const revealedPc = React.useRef<number | null>(null)
	const toggleBreakpointLineRef = React.useRef(toggleBreakpointLine)
	const toggleBreakpointAddressRef = React.useRef(toggleBreakpointAddress)
	const setBreakpointLinesRef = React.useRef(setBreakpointLines)
	const breakpointLinesRef = React.useRef(breakpointLines)
	const copiedBreakpointLinesRef = React.useRef<{ text: string, relativeLines: number[] } | null>(null)
	const isEntryFileRef = React.useRef(isEntryFile)

	toggleBreakpointLineRef.current = toggleBreakpointLine
	toggleBreakpointAddressRef.current = toggleBreakpointAddress
	setBreakpointLinesRef.current = setBreakpointLines
	breakpointLinesRef.current = breakpointLines
	isEntryFileRef.current = isEntryFile

	const handleEditorMount: OnMount = React.useCallback((editorInstance, monaco) => {
		editorRef.current = editorInstance
		monacoRef.current = monaco
		if (isEntryFileRef.current) setFindReplaceEditor(editorInstance)
		if (!dataTipsRegistered) {
			dataTipsRegistered = true
			registerMipsDebugDataTips(monaco, () => {
				const { code, registers, memory, fpRegisters } = useTHRAXStore.getState()
				return { code, registers, memory, fpRegisters }
			})
		}
		const editorDomNode = editorInstance.getDomNode()
		const captureBreakpointCopy = (event: ClipboardEvent) => {
			const model = editorInstance.getModel()
			const selection = editorInstance.getSelection()
			if (!model || !selection || selection.isEmpty()) return
			const startLine = selection.startLineNumber
			const relativeLines = [...breakpointLinesRef.current]
				.filter((line) => line >= startLine && line <= selection.endLineNumber)
				.map((line) => line - startLine)
			const copied = { text: model.getValueInRange(selection), relativeLines }
			copiedBreakpointLinesRef.current = copied
			try {
				event.clipboardData?.setData('application/x-thrax-breakpoints', JSON.stringify(copied))
			} catch {
				// Browsers may disallow custom clipboard formats; the in-app fallback remains.
			}
		}
		editorDomNode?.addEventListener('copy', captureBreakpointCopy)
		editorInstance.onMouseDown((event) => {
			if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
			const line = event.target.position?.lineNumber
			if (!line) return
			toggleBreakpointLineRef.current(line)
		})
		// Breakpoints belong to the file being assembled, so an edit elsewhere
		// must not report that file's lines as having moved.
		editorInstance.onDidChangeModelContent(() => {
			const model = editorInstance.getModel()
			if (!model || !isEntryFileRef.current) return
			const movedLines = breakpointDecorationIds.current
				.map((id) => model.getDecorationRange(id)?.startLineNumber)
				.filter((line): line is number => line !== undefined)
			setBreakpointLinesRef.current(movedLines)
		})
		editorInstance.onDidPaste((event) => {
			if (!isEntryFileRef.current) return
			const plainText = event.clipboardEvent?.clipboardData?.getData('text/plain') ?? ''
			const encoded = event.clipboardEvent?.clipboardData?.getData('application/x-thrax-breakpoints')
			let copied = copiedBreakpointLinesRef.current
			if (encoded) {
				try {
					const parsed: unknown = JSON.parse(encoded)
					if (typeof parsed === 'object' && parsed !== null && 'text' in parsed && 'relativeLines' in parsed &&
						typeof parsed.text === 'string' && Array.isArray(parsed.relativeLines)) {
						copied = {
							text: parsed.text,
							relativeLines: parsed.relativeLines.filter((line): line is number => typeof line === 'number' && Number.isInteger(line)),
						}
					}
				} catch {
					// Custom clipboard formats are optional in browsers.
				}
			}
			if (!copied || (plainText && plainText !== copied.text)) return
			const nextLines = new Set(breakpointLinesRef.current)
			for (const relativeLine of copied.relativeLines) nextLines.add(event.range.startLineNumber + relativeLine)
			setBreakpointLinesRef.current(nextLines)
		})
		editorInstance.onDidDispose(() => editorDomNode?.removeEventListener('copy', captureBreakpointCopy))
	}, [])

	// The toolbar's Find opens Monaco's find widget on the assembled file, so
	// this editor claims it for as long as it holds that file.
	React.useEffect(() => {
		if (!isEntryFile) return
		setFindReplaceEditor(editorRef.current)
		return () => setFindReplaceEditor(null)
	}, [isEntryFile])

	// Debugger keys, captured before Monaco claims F8 and friends.  Only the
	// editor holding the assembled program listens, so one press steps once.
	React.useEffect(() => {
		if (!isEntryFile) return
		const handler = (event: KeyboardEvent) => {
			if (!/^F(5|7|8|9|10)$/.test(event.key) || event.repeat) return
			const store = useTHRAXStore.getState()
			const line = editorRef.current?.getPosition()?.lineNumber
			// Blank and comment lines carry no address, so aim at the next line that does.
			const addressAt = (from?: number) =>
				from === undefined ? undefined : store.sourceIndex.codeAddressAtOrAfter(store.sourceIndex.entryFile, from)

			switch (event.key) {
				case 'F5':
					if (event.altKey) {
						store.pause()
						store.reset()
					} else if (event.shiftKey) {
						store.reset()
						void store.run()
					} else if (store.isPaused) void store.continue()
					else void store.run()
					break
				case 'F7': {
					// Step out needs no cursor address, so it comes first.
					if (event.shiftKey && !event.ctrlKey) {
						void store.stepToReturn()
						break
					}
					const address = addressAt(line)
					if (address === undefined) break
					if (event.ctrlKey && event.shiftKey) store.setProgramCounter(address)
					else void store.runToAddress(address)
					break
				}
				case 'F8':
					store.step()
					break
				case 'F9':
					if (line !== undefined) store.toggleBreakpointLine(line)
					break
				case 'F10':
					void store.stepOver()
					break
			}
			event.preventDefault()
			event.stopPropagation()
		}
		window.addEventListener('keydown', handler, true)
		return () => window.removeEventListener('keydown', handler, true)
	}, [isEntryFile])

	// Machine words only reach the gutter when at least one column is turned on.
	const showGutter = codeWords.size > 0 && (showAddresses || showCodeBytes || showDisassembly)
	// An address alone says nothing about a word, so the extra rows a
	// pseudo-instruction needs appear only once a column describes them.
	const showWordRows = showGutter && (showCodeBytes || showDisassembly)

	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		if (!editorInstance || !monaco) return

		// Pseudo-instructions put several words on one line; each maps back to it.
		const lineAt = (address: number | null) => {
			if (address === null) return undefined
			const location = sourceIndex.lineForAddress(address)
			return location?.file === sourceIndex.entryFile ? location.line : undefined
		}
		const breakpointDecorations: editor.IModelDeltaDecoration[] = [...breakpointLines]
			.map((line) => ({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					glyphMarginClassName: 'breakpoint-glyph',
					isWholeLine: true,
					stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
				},
			}))
		breakpointDecorationIds.current = editorInstance.deltaDecorations(breakpointDecorationIds.current, breakpointDecorations)

		const executionDecorations: editor.IModelDeltaDecoration[] = []
		const currentLine = lineAt(pc)
		// A pseudo-instruction's later words own their own gutter row, which carries
		// the pointer itself; the source line keeps it only when no such row shows.
		const firstAddress = currentLine === undefined ? undefined : sourceIndex.addressesForLine(sourceIndex.entryFile, currentLine)[0]
		const onGutterRow = showWordRows && firstAddress !== undefined && firstAddress !== pc
		if (currentLine !== undefined && !onGutterRow) {
			executionDecorations.push({
				range: new monaco.Range(currentLine, 1, currentLine, 1),
				options: {
					className: 'current-execution-line',
					isWholeLine: true,
					linesDecorationsClassName: 'current-execution-arrow',
				},
			})
		}
		executionDecorationIds.current = editorInstance.deltaDecorations(executionDecorationIds.current, executionDecorations)

		// The memory view reports the instruction word under the pointer.
		const hoverDecorations: editor.IModelDeltaDecoration[] = []
		const hoveredLine = lineAt(hoveredAddress)
		if (hoveredLine !== undefined) {
			hoverDecorations.push({
				range: new monaco.Range(hoveredLine, 1, hoveredLine, 1),
				options: { className: 'memory-hover-line', isWholeLine: true },
			})
		}
		hoverDecorationIds.current = editorInstance.deltaDecorations(hoverDecorationIds.current, hoverDecorations)

		// Every live frame returns somewhere, marked by an arrow in the margin.
		const selectedAddress = selectedFrame === null ? null
			: selectedFrame === -1 ? pc
				: callStack[selectedFrame]?.returnAddress ?? null
		const frameDecorations: editor.IModelDeltaDecoration[] = []
		for (const frame of callStack) {
			const line = lineAt(frame.returnAddress)
			if (line === undefined) continue
			frameDecorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					linesDecorationsClassName: `return-address-arrow${frame.returnAddress === selectedAddress ? ' selected' : ''}`,
				},
			})
		}
		frameDecorationIds.current = editorInstance.deltaDecorations(frameDecorationIds.current, frameDecorations)

		if (selectedFrame !== revealedFrameRef.current) {
			revealedFrameRef.current = selectedFrame
			const line = lineAt(selectedAddress)
			if (line !== undefined) editorInstance.revealLineInCenterIfOutsideViewport(line)
		}
	}, [breakpointLines, breakpoints, callStack, hoveredAddress, pc, selectedFrame, showWordRows, sourceIndex])

	// Assembly diagnostics for this file, as squiggles under the offending text.
	// An empty list clears them, so a fixed line stops being marked as the user types.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return

		const lineCount = model.getLineCount()
		const markers: editor.IMarkerData[] = diagnostics.map((diagnostic) => {
			const line = Math.min(Math.max(diagnostic.line ?? 1, 1), lineCount)
			const lineEnd = model.getLineMaxColumn(line)
			const startColumn = Math.min(Math.max(diagnostic.column ?? 1, 1), lineEnd)
			// Without a column of its own, a diagnostic marks the whole line.
			const endColumn = Math.min(diagnostic.endColumn ?? (diagnostic.column === undefined ? lineEnd : startColumn + 1), lineEnd)
			return {
				severity: diagnostic.severity === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error,
				message: diagnostic.message,
				source: 'thrax',
				startLineNumber: line,
				startColumn,
				endLineNumber: line,
				endColumn: Math.max(endColumn, startColumn + 1),
			}
		})
		monaco.editor.setModelMarkers(model, 'thrax', markers)
	}, [code, diagnostics])

	// Stepping keeps the instruction about to run inside the middle third of the
	// editor: crossing an edge scrolls by just enough to hold it there, so the
	// next instruction lands where the last one was rather than jumping.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		if (!editorInstance || !monaco || revealedPc.current === pc) return
		revealedPc.current = pc

		const location = sourceIndex.lineForAddress(pc)
		if (location?.file !== sourceIndex.entryFile) return
		const line = location.line
		// A pseudo-instruction's later words sit in rows of their own below the line.
		const row = showWordRows ? Math.max(0, sourceIndex.addressesForLine(location.file, line).indexOf(pc)) : 0

		const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight)
		const { height } = editorInstance.getLayoutInfo()
		const top = editorInstance.getTopForLineNumber(line) + row * lineHeight
		const offset = top - editorInstance.getScrollTop()
		const highest = height / 3
		const lowest = (height * 2) / 3 - lineHeight
		if (offset >= highest && offset <= lowest) return
		editorInstance.setScrollTop(Math.max(0, top - (offset < highest ? highest : lowest)))
	}, [pc, showWordRows, sourceIndex])

	// Execution counts, as a heat map over the line numbers and a hover that
	// reports what the profile, the branch predictor and the pipeline model saw
	// at every machine word the line assembled to.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return

		const bhtEntryFor = new Map(branchHistory.entries.flatMap((entry) => entry.addresses.map((address) => [address, entry] as const)))
		const lineCount = model.getLineCount()
		const decorations: editor.IModelDeltaDecoration[] = []

		for (const [line, words] of codeWords) {
			if (line > lineCount) continue
			// Data holds no instructions, so only code words carry a profile.
			const instructions = words.filter((word) => word.word !== null)
			if (instructions.length === 0) continue
			const count = instructions.reduce((total, word) => total + (profile.byAddress.get(word.address)?.count ?? 0), 0)
			const level = heatLevel(count, profile.max)
			const hover: string[] = []

			for (const word of instructions) {
				const entry = profile.byAddress.get(word.address)
				const text = word.word === null ? '' : disassemble(word.word, word.address) ?? ''
				hover.push(`**${formatAddress(word.address)}**${text ? `  \`${text}\`` : ''}`)
				if (!entry || entry.count === 0) {
					hover.push('- Never executed')
					continue
				}
				const share = profile.total === 0 ? 0 : (entry.count / profile.total) * 100
				hover.push(`- Executed **${entry.count.toLocaleString()}** times (${share.toFixed(1)}% of ${profile.total.toLocaleString()})`)

				const branches = entry.taken + entry.notTaken
				if (branches > 0) {
					hover.push(`- Branch taken ${entry.taken.toLocaleString()}, not taken ${entry.notTaken.toLocaleString()} (${((entry.taken / branches) * 100).toFixed(1)}% taken)`)
					const bht = bhtEntryFor.get(word.address)
					if (bht && bht.predictions > 0) {
						const aliases = bht.addresses.length - 1
						hover.push(`- BHT entry ${bht.index} predicts ${bht.predictTaken ? 'taken' : 'not taken'}: ${bht.correct.toLocaleString()}/${bht.predictions.toLocaleString()} correct${aliases > 0 ? ` (shared with ${aliases} other branch${aliases > 1 ? 'es' : ''})` : ''}`)
					}
				}

				const stats = pipeline.byAddress.get(word.address)
				if (stats) {
					const costs: string[] = []
					if (stats.stalls > 0) costs.push(`${stats.stalls.toLocaleString()} stall cycles${stats.loadUseStalls > 0 ? ` (${stats.loadUseStalls.toLocaleString()} load-use)` : ''}`)
					if (stats.flushed > 0) costs.push(`${stats.flushed.toLocaleString()} cycles refilling after the instruction before`)
					if (stats.branches > 0) costs.push(`${stats.mispredictions.toLocaleString()}/${stats.branches.toLocaleString()} mispredicted`)
					if (costs.length > 0) hover.push(`- Pipeline: ${costs.join(', ')}`)
				}
			}

			decorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					isWholeLine: true,
					...(showHeatMap && level >= 0 ? {
						lineNumberClassName: `heat-number heat-level-${level}`,
						...(showHeatLines ? { className: `heat-line-${level}` } : {}),
					} : {}),
					lineNumberHoverMessage: { value: hover.join('\n') },
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				},
			})
		}

		profileDecorationIds.current = editorInstance.deltaDecorations(profileDecorationIds.current, decorations)
	}, [branchHistory, code, codeWords, pipeline, profile, showHeatLines, showHeatMap])

	// Once the source assembles, the gutter columns sit between the line numbers
	// and the source, one row per machine word.
	React.useEffect(() => {
		const editorInstance = editorRef.current
		const monaco = monacoRef.current
		const model = editorInstance?.getModel()
		if (!editorInstance || !monaco || !model) return

		const rows = [...codeWords.values()].flat()
		const assembly = new Map<number, string>()
		rows.forEach((row, index) => {
			assembly.set(row.address, row.word === null ? disassembleData(row, rows[index + 1]) : disassemble(row.word, row.address) ?? '')
		})
		// One width per column keeps the source aligned down the whole file.
		const codeWidth = Math.max(0, ...rows.map((row) => formatCodeWord(row).length))
		const assemblyWidth = Math.max(0, ...[...assembly.values()].map((text) => text.length))
		const gutterText = (entry?: CodeWord) => {
			const columns: string[] = []
			if (showAddresses) columns.push((entry ? formatAddress(entry.address) : '').padEnd(10))
			if (showCodeBytes) columns.push((entry ? formatCodeWord(entry) : '').padEnd(codeWidth))
			if (showDisassembly) columns.push((entry ? assembly.get(entry.address) ?? '' : '').padEnd(assemblyWidth))
			return columns.join(COLUMN_GAP) + COLUMN_GAP
		}

		const lineCount = model.getLineCount()
		const decorations: editor.IModelDeltaDecoration[] = []
		for (let line = 1; showGutter && line <= lineCount; line += 1) {
			const words = codeWords.get(line)
			decorations.push({
				range: new monaco.Range(line, 1, line, 1),
				options: {
					// Lines without code keep the columns blank so the source stays aligned.
					before: { content: gutterText(words?.[0]), inlineClassName: words?.[0].address === pc ? 'code-word code-word-current' : 'code-word' },
					// Monaco drops injected text on an empty range without this.
					showIfCollapsed: true,
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
				},
			})
		}
		codeWordDecorationIds.current = editorInstance.deltaDecorations(codeWordDecorationIds.current, decorations)

		const lineHeight = editorInstance.getOption(monaco.editor.EditorOption.lineHeight)
		const fontInfo = editorInstance.getOption(monaco.editor.EditorOption.fontInfo)
		const layout = editorInstance.getLayoutInfo()
		editorInstance.changeViewZones((accessor) => {
			for (const id of codeWordZoneIds.current) accessor.removeZone(id)
			codeWordZoneIds.current = []
			if (!showWordRows) return
			for (const [line, words] of codeWords) {
				if (words.length < 2 || line > lineCount) continue
				const domNode = document.createElement('div')
				domNode.className = 'code-word-zone'
				domNode.style.fontFamily = fontInfo.fontFamily
				domNode.style.fontSize = `${fontInfo.fontSize}px`
				// These words have no source line, so the zone brings its own margin:
				// a breakpoint spot and, when the pc is here, the execution pointer.
				const marginDomNode = document.createElement('div')
				marginDomNode.className = 'code-word-zone-margin'
				for (const entry of words.slice(1)) {
					const row = document.createElement('div')
					row.className = entry.address === pc ? 'code-word code-word-row-current' : 'code-word'
					row.style.height = `${lineHeight}px`
					row.style.lineHeight = `${lineHeight}px`
					row.textContent = gutterText(entry)
					domNode.append(row)

					const marginRow = document.createElement('div')
					marginRow.className = 'code-word-margin-row'
					marginRow.style.height = `${lineHeight}px`
					marginDomNode.append(marginRow)
					// Data never executes, so only code rows take a breakpoint.
					if (entry.word === null) continue
					const glyph = document.createElement('div')
					glyph.className = breakpoints.has(entry.address) ? 'code-word-breakpoint active' : 'code-word-breakpoint'
					glyph.style.left = `${layout.glyphMarginLeft}px`
					glyph.style.width = `${layout.glyphMarginWidth}px`
					glyph.title = `Toggle breakpoint at ${formatWord(entry.address)}`
					glyph.addEventListener('mousedown', (event) => {
						event.preventDefault()
						event.stopPropagation()
						toggleBreakpointAddressRef.current(entry.address)
					})
					marginRow.append(glyph)
					if (entry.address === pc) {
						const arrow = document.createElement('div')
						arrow.className = 'current-execution-arrow code-word-arrow'
						arrow.style.left = `${layout.decorationsLeft}px`
						marginRow.append(arrow)
					}
				}
				codeWordZoneIds.current.push(accessor.addZone({ afterLineNumber: line, heightInLines: words.length - 1, domNode, marginDomNode }))
			}
		})
	}, [breakpoints, code, codeWords, pc, showAddresses, showCodeBytes, showDisassembly, showGutter, showWordRows])

	return (
		<div className="source-pane">
			<div className="source-editor">
				<Editor
					height="100%"
					defaultLanguage="mips"
					value={code}
					onChange={(value) => setDocumentCode(documentId, value ?? '')}
					theme="vs-dark"
					options={{
						minimap: { enabled: false },
						glyphMargin: true,
						fontSize: 14,
						lineNumbers: 'on',
						lineNumbersMinChars: 2,
						scrollBeyondLastLine: false,
						automaticLayout: true,
					}}
					onMount={handleEditorMount}
				/>
			</div>
		</div>
	)
}

export default SourcePane

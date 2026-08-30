/**
 * Screen Magnifier: a lens over the THRAX workspace itself.
 *
 * DELIBERATE REINTERPRETATION, NOT A PORT. The original captures
 * the desktop with `java.awt.Robot`,
 * which has no browser equivalent - a web page cannot photograph pixels outside
 * its own document, and pulling in a dependency to fake it is out of scope here.
 * So instead of magnifying the screen, this panel magnifies THRAX's own live DOM:
 * "Capture" clones `document.body` (minus this panel's own subtree, tagged
 * `data-magnifier-exclude`, so the lens does not show a frozen copy of itself)
 * at its natural on-screen size, then scales and repositions that clone with
 * CSS `transform` so the point under the cursor at capture time lands centred
 * in a small fixed viewport - a zoom lens over a still image of the workspace,
 * not a live feed. No canvas capture API, no dependency, one DOM clone per
 * click. The scale control's range mirrors MARS's own
 * (`SCALE_MINIMUM`/`SCALE_MAXIMUM`/`SCALE_INCREMENT`/`SCALE_DEFAULT`,
 * `Magnifier` inner class): 1.0-4.0 in 0.5 steps,
 * default 2.0. Not reproduced: the scribbler annotation tool, the settings
 * dialog, and continuous live tracking (MARS's own capture is manual too,
 * triggered by its "Capture" button, not a background thread).
 *
 * This is a panel only - it observes nothing and has no `tools/` accumulator,
 * per the task: there is nothing here for a test to exercise without a DOM,
 * and no test environment is configured for this project (see the test file
 * for tools/scavengerHunt.ts for what a DOM-dependent panel forgoes here too).
 */

import { useEffect, useRef, useState } from 'react'
import './ToolPanels.css'
import './ScreenMagnifierView.css'

const SCALE_MIN = 1
const SCALE_MAX = 4
const SCALE_STEP = 0.5
const SCALE_DEFAULT = 2
const VIEWPORT_SIZE = 260 // px, this panel's own display box

interface Point {
	x: number
	y: number
}

function ScreenMagnifierView() {
	const [scale, setScale] = useState(SCALE_DEFAULT)
	const [captured, setCaptured] = useState(false)
	const viewportRef = useRef<HTMLDivElement | null>(null)
	const cloneRef = useRef<HTMLElement | null>(null)
	const pointerRef = useRef<Point>({ x: 0, y: 0 })
	const capturedPointRef = useRef<Point | null>(null)

	// Tracked continuously so Capture always uses where the cursor last was,
	// even though the capture itself only happens on demand.
	useEffect(() => {
		function onMove(event: MouseEvent) {
			pointerRef.current = { x: event.clientX, y: event.clientY }
		}
		window.addEventListener('mousemove', onMove)
		return () => window.removeEventListener('mousemove', onMove)
	}, [])

	// A scale change re-zooms the still image already captured, around the
	// same captured point - it does not take a new snapshot.
	useEffect(() => {
		if (cloneRef.current && capturedPointRef.current) position(cloneRef.current, capturedPointRef.current, scale)
	}, [scale])

	function position(clone: HTMLElement, point: Point, atScale: number) {
		clone.style.transformOrigin = '0 0'
		clone.style.transform = `scale(${atScale})`
		clone.style.left = `${VIEWPORT_SIZE / 2 - point.x * atScale}px`
		clone.style.top = `${VIEWPORT_SIZE / 2 - point.y * atScale}px`
	}

	function capture() {
		const viewport = viewportRef.current
		if (!viewport) return
		const clone = document.body.cloneNode(true) as HTMLElement
		clone.querySelectorAll('[data-magnifier-exclude]').forEach((node) => node.remove())
		clone.removeAttribute('id')
		clone.style.position = 'absolute'
		clone.style.margin = '0'
		clone.style.width = `${document.documentElement.clientWidth}px`
		clone.style.height = `${document.documentElement.clientHeight}px`
		clone.style.pointerEvents = 'none'

		const point = { ...pointerRef.current }
		position(clone, point, scale)

		viewport.innerHTML = ''
		viewport.appendChild(clone)
		cloneRef.current = clone
		capturedPointRef.current = point
		setCaptured(true)
	}

	return (
		<div className="tool" data-magnifier-exclude>
			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{scale.toFixed(1)}&times;</span>
					<span className="tool-metric-label">Scale</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{captured ? 'Captured' : 'Idle'}</span>
					<span className="tool-metric-label">State</span>
				</div>
			</div>

			<div className="tool-settings">
				<label>
					Scale
					<input
						type="range"
						min={SCALE_MIN}
						max={SCALE_MAX}
						step={SCALE_STEP}
						value={scale}
						onChange={(event) => setScale(Number(event.target.value))}
					/>
				</label>
				<button type="button" onClick={capture}>Capture</button>
			</div>

			<div className="screen-magnifier-frame" style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}>
				<div className="screen-magnifier-viewport" ref={viewportRef} />
				{!captured && (
					<div className="screen-magnifier-placeholder tool-empty">Point anywhere in THRAX, then Capture.</div>
				)}
			</div>
		</div>
	)
}

export default ScreenMagnifierView

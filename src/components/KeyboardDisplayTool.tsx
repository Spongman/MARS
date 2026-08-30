import React from 'react'
import type { KeyboardDisplayState } from '../core/types'
import './KeyboardDisplayTool.css'

interface KeyboardDisplayToolProps {
	device: KeyboardDisplayState
	onSend: (input: string) => void
}

/**
 * The Keyboard and Display Simulator: programs reach it through the MMIO words
 * at 0xffff0000 through 0xffff000c.
 */
function KeyboardDisplayTool({ device, onSend }: KeyboardDisplayToolProps) {
	const [input, setInput] = React.useState('')
	const outputRef = React.useRef<HTMLPreElement>(null)

	React.useEffect(() => {
		if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight
	}, [device.displayOutput])

	const send = (event: React.FormEvent) => {
		event.preventDefault()
		if (!input) return
		onSend(input)
		setInput('')
	}

	return (
		<section className="keyboard-display-tool" aria-label="Keyboard and Display Simulator">
		<p className="keyboard-display-help">
			MMIO: receiver control/data <code>0xffff0000</code>/<code>0xffff0004</code>; transmitter control/data <code>0xffff0008</code>/<code>0xffff000c</code>.
		</p>
		<div className="keyboard-display-status">
			<span>Receiver: {device.queuedInput ? `ready (${device.queuedInput.length} queued)` : 'empty'}</span>
			<span>Transmitter: ready</span>
		</div>
		<label htmlFor="keyboard-display-output">Display</label>
		<pre id="keyboard-display-output" className="keyboard-display-output" ref={outputRef}>
			{device.displayOutput || 'Program MMIO output will appear here'}
		</pre>
		<form className="keyboard-display-input" onSubmit={send}>
			<label htmlFor="keyboard-display-input">Keyboard input</label>
			<input
				id="keyboard-display-input"
				value={input}
				onChange={(event) => setInput(event.target.value)}
				placeholder="Characters to queue"
			/>
			<button type="submit">Queue</button>
		</form>
		</section>
	)
}

export default KeyboardDisplayTool

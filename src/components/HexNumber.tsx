import './HexNumber.css'

/** Splits `0x0040F000` into its prefix, its leading zeros, and the rest. */
function splitHex(text: string) {
	const prefix = /^0[xX]/.test(text) ? text.slice(0, 2) : ''
	const digits = text.slice(prefix.length)
	const significant = digits.replace(/^0+/, '')
	// An all-zero value keeps its final digit, so something stays readable.
	const zeros = significant.length === 0 ? digits.slice(0, -1) : digits.slice(0, digits.length - significant.length)
	return { prefix, zeros, rest: digits.slice(zeros.length) }
}

/** Renders a hex number with its leading zeros dimmed. */
function HexNumber({ text }: { text: string }) {
	const { prefix, zeros, rest } = splitHex(text)
	return (
		<>
			{prefix}
			{zeros && <span className="hex-zero">{zeros}</span>}
			{rest}
		</>
	)
}

export default HexNumber

/** Addresses: a location marker over its column. */
export function AddressIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M5.5 2 L5.5 14 M10.5 2 L10.5 14 M2 5.5 L14 5.5 M2 10.5 L14 10.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
		</svg>
	)
}

/** Machine words: two rows of byte cells. */
export function CodeBytesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1" y="3" width="6" height="4" rx="1" />
			<rect x="9" y="3" width="6" height="4" rx="1" />
			<rect x="1" y="9" width="6" height="4" rx="1" />
			<rect x="9" y="9" width="6" height="4" rx="1" />
		</svg>
	)
}

/** Disassembly: a prompt chevron ahead of instruction text. */
export function DisassemblyIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M1.5 4 L4 6.5 L1.5 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
			<rect x="6" y="3" width="9" height="1.6" rx="0.8" />
			<rect x="6" y="7" width="6" height="1.6" rx="0.8" />
			<rect x="1" y="11" width="14" height="1.6" rx="0.8" />
		</svg>
	)
}

/** Profile heat map: a flame over the line numbers. */
export function HeatMapIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 1c2.5 3 4.5 4.6 4.5 7.5A4.5 4.5 0 0 1 3.5 8.5C3.5 6.8 4.4 5.6 5.4 4.6c.2 1.3.8 2 1.6 2.2C6.4 4.6 6.8 2.7 8 1z" />
			<path d="M8 14.5a2.4 2.4 0 0 0 2.4-2.4c0-1.4-1.2-2.2-2.4-3.9-1.2 1.7-2.4 2.5-2.4 3.9A2.4 2.4 0 0 0 8 14.5z" fill="var(--surface-input, #1e1e1e)" />
		</svg>
	)
}

/** Line tint: the heat map painted behind the source line as well. */
export function HeatLinesIcon() {
	return (
		<svg className="toggle-icon" viewBox="0 0 16 16" aria-hidden="true">
			<rect x="1" y="2" width="14" height="2.4" rx="0.8" opacity="0.45" />
			<rect x="1" y="6.8" width="14" height="2.4" rx="0.8" />
			<rect x="1" y="11.6" width="14" height="2.4" rx="0.8" opacity="0.45" />
		</svg>
	)
}

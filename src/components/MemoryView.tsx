import React from 'react'
import './MemoryView.css'
import type { MemoryView as Memory } from '../core/types'
import { formatHex, formatWord, parseWord } from '../core/format'
import { disassemble } from '../core/disassembler'
import { nextToggles } from './toggleGroup'
import HexNumber from './HexNumber'
import { isFlagSet, isOneOf, useStoredState } from '../hooks/useStoredState'

interface MemoryViewProps {
	memory: Memory
	/** Address of the instruction about to execute, or null when there is none. */
	pc: number | null
	/** Return addresses of the live call stack frames. */
	returnAddresses: Set<number>
	/** Address to scroll to when it changes, from a selected call stack frame. */
	focusAddress: number | null
	onHoverAddress: (address: number | null) => void
}

interface MemorySection { id: string; label: string; start: number; end: number }

/** THRAX memory map segments, ordered as they appear in the address space. */
const SECTIONS: MemorySection[] = [
	{ id: 'text', label: '.text', start: 0x00400000, end: 0x0ffffffc },
	{ id: 'data', label: '.data', start: 0x10010000, end: 0x1003fffc },
	{ id: 'heap', label: 'heap', start: 0x10040000, end: 0x6ffffffc },
	{ id: 'stack', label: 'stack', start: 0x70000000, end: 0x7ffffffc },
	{ id: 'kdata', label: 'kernel', start: 0x80000000, end: 0xfffefffc },
	{ id: 'mmio', label: 'MMIO', start: 0xffff0000, end: 0xfffffffc },
]

const TEXT_SECTION = SECTIONS[0]

const GROUP_SIZES = [1, 2, 4, 8]
const ROW_HEIGHT = 18
/** Rows kept in the scroll region; large sections are windowed around the current address. */
const MAX_WINDOW_ROWS = 16384
const ADDRESS_COLUMNS = 12
const OVERSCAN_ROWS = 6

const formatAddress = formatWord

const sectionForAddress = (address: number) => SECTIONS.find((section) => address >= section.start && address <= section.end)

/** Little-endian byte read against the word-indexed memory view. */
const byteAt = (memory: Memory, address: number) => {
	const word = memory[formatAddress((address & ~3) >>> 0)] ?? 0
	return (word >>> ((address & 3) * 8)) & 0xff
}

const toPrintable = (byte: number) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.')

const toHex = (byte: number) => formatHex(byte, 2)

/** Little-endian value of a byte run; BigInt keeps 8-byte groups exact. */
const groupValue = (bytes: number[]) => {
	let value = 0n
	for (let index = bytes.length - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[index])
	return value
}

interface HoverRange { start: number, size: number, rect: { left: number, top: number, bottom: number } }
interface MemoryByte { address: number, value: number }
interface MemoryGroup { start: number, bytes: MemoryByte[], zero: boolean, leadingZeros: number, value: number | null }
interface MemoryRowData { address: number, groups: MemoryGroup[], bytes: MemoryByte[] }

const MemoryRow = React.memo(function MemoryRow({ row, top, left, width, groupSize, showAscii, hover, pc, returnAddresses }: {
	row: MemoryRowData
	top: number
	left: number
	width: number
	groupSize: number
	showAscii: boolean
	hover: HoverRange | null
	pc: number | null
	returnAddresses: Set<number>
}) {
	const isHovered = (address: number) => hover !== null && address >= hover.start && address < hover.start + hover.size

	return (
		<div className="memory-row" style={{ top, left, width }}>
			<span className="memory-row-address"><HexNumber text={formatAddress(row.address)} /></span>
			<span className="memory-row-groups">
				{row.groups.map((group, groupIndex) => (
					<span
						key={groupIndex}
						className={[
							'memory-group',
							group.zero ? 'zero' : '',
							group.start === pc ? 'current-instruction' : '',
							returnAddresses.has(group.start) ? 'return-address' : '',
							group.value !== null && returnAddresses.has(group.value) ? 'return-slot' : '',
						].filter(Boolean).join(' ')}
						data-address={group.start}
						data-size={groupSize}
					>
						{/* Little-endian: the highest address is the most significant digit pair. */}
						{[...group.bytes].reverse().map((byte, byteIndex) => {
							const text = toHex(byte.value)
							// Leading zeros of the whole group dim, across byte boundaries.
							const dimmed = Math.min(2, Math.max(0, group.leadingZeros - byteIndex * 2))
							return (
								<span key={byteIndex} className={`memory-byte ${isHovered(byte.address) ? 'hovered' : ''}`}>
									{dimmed > 0 && <span className="hex-zero">{text.slice(0, dimmed)}</span>}
									{text.slice(dimmed)}
								</span>
							)
						})}
					</span>
				))}
			</span>
			{showAscii && (
				<span className="memory-row-ascii">
					{row.bytes.map((byte, byteIndex) => (
						<span
							key={byteIndex}
							className={`memory-char ${isHovered(byte.address) ? 'hovered' : ''}`}
							data-address={byte.address}
							data-size={1}
						>
							{toPrintable(byte.value)}
						</span>
					))}
				</span>
			)}
		</div>
	)
})

function MemoryView({ memory, pc, returnAddresses, focusAddress, onHoverAddress }: MemoryViewProps) {
	const [addressInput, setAddressInput] = React.useState(formatAddress(TEXT_SECTION.start))
	const [sectionId, setSectionId] = useStoredState('memory.section', TEXT_SECTION.id, isOneOf(SECTIONS.map((entry) => entry.id)))
	const [groupSize, setGroupSize] = useStoredState('memory.groupSize', 4, isOneOf(GROUP_SIZES))
	const [rowOptions, setRowOptions] = useStoredState('memory.rows', { powerOfTwo: true, ascii: true }, isFlagSet(['powerOfTwo', 'ascii']))
	const { ascii: showAscii, powerOfTwo: powerOfTwoRows } = rowOptions
	const [addressError, setAddressError] = React.useState<string | null>(null)
	const [windowStart, setWindowStart] = React.useState(TEXT_SECTION.start)
	const [pendingReveal, setPendingReveal] = React.useState<number | null>(null)
	const [scrollTop, setScrollTop] = React.useState(0)
	const [viewport, setViewport] = React.useState({ width: 0, height: 0 })
	const [charWidth, setCharWidth] = React.useState(7.2)
	const [hover, setHover] = React.useState<HoverRange | null>(null)
	const [frame, setFrame] = React.useState({ top: 0, left: 0, width: 0 })
	const [layoutTick, setLayoutTick] = React.useState(0)
	const scrollRef = React.useRef<HTMLDivElement>(null)
	const focusedRef = React.useRef<number | null>(null)
	const originRef = React.useRef<HTMLSpanElement>(null)
	const probeRef = React.useRef<HTMLSpanElement>(null)

	const section = SECTIONS.find((entry) => entry.id === sectionId) ?? SECTIONS[0]

	React.useLayoutEffect(() => {
		const width = probeRef.current?.getBoundingClientRect().width
		if (width) setCharWidth(width / 20)
	}, [])

	React.useLayoutEffect(() => {
		const element = scrollRef.current
		if (!element) return
		const observer = new ResizeObserver(() => setViewport({ width: element.clientWidth, height: element.clientHeight }))
		observer.observe(element)
		setViewport({ width: element.clientWidth, height: element.clientHeight })
		return () => observer.disconnect()
	}, [])

	// Fixed rows are placed by hand, so measure where their containing block actually
	// starts: an ancestor with a transform, filter or clip-path takes that role from the
	// viewport, and the probe below reports whichever one wins.
	React.useLayoutEffect(() => {
		const grid = scrollRef.current
		const origin = originRef.current
		if (!grid || !origin) return
		const gridRect = grid.getBoundingClientRect()
		const originRect = origin.getBoundingClientRect()
		const next = {
			top: gridRect.top + grid.clientTop - originRect.top,
			left: gridRect.left + grid.clientLeft - originRect.left,
			width: grid.clientWidth,
		}
		setFrame((current) => (current.top === next.top && current.left === next.left && current.width === next.width ? current : next))
	}, [layoutTick, showAscii, viewport, scrollTop])

	// Fixed rows sit outside the grid's scroll chain, so the wheel never reaches it.
	React.useEffect(() => {
		const grid = scrollRef.current
		if (!grid) return
		const onWheel = (event: WheelEvent) => {
			const factor = event.deltaMode === 1 ? ROW_HEIGHT : event.deltaMode === 2 ? grid.clientHeight : 1
			grid.scrollTop += event.deltaY * factor
			grid.scrollLeft += event.deltaX * factor
			event.preventDefault()
		}
		grid.addEventListener('wheel', onWheel, { passive: false })
		return () => grid.removeEventListener('wheel', onWheel)
	}, [])

	// A move of an ancestor does not resize the grid, so re-measure on those too.
	React.useEffect(() => {
		const remeasure = (event?: Event) => {
			// The grid's own scrolling already re-measures through the effect above.
			if (event?.target === scrollRef.current) return
			setLayoutTick((tick) => tick + 1)
		}
		window.addEventListener('resize', remeasure)
		window.addEventListener('scroll', remeasure, true)
		return () => {
			window.removeEventListener('resize', remeasure)
			window.removeEventListener('scroll', remeasure, true)
		}
	}, [])

	// As many groups as fit the row, counting the ASCII column. Rounding the row
	// length down to a power of two keeps addresses aligned at the cost of width.
	const bytesPerRow = React.useMemo(() => {
		const perGroup = (groupSize * 2 + 1 + (showAscii ? groupSize : 0)) * charWidth
		const available = viewport.width - (ADDRESS_COLUMNS + (showAscii ? 2 : 0)) * charWidth - 16
		const groups = Math.max(1, Math.floor(available / perGroup))
		const bytes = groups * groupSize
		return powerOfTwoRows ? Math.max(groupSize, 2 ** Math.floor(Math.log2(bytes))) : bytes
	}, [charWidth, groupSize, powerOfTwoRows, showAscii, viewport.width])

	const alignedWindowStart = Math.max(section.start, windowStart - (windowStart % bytesPerRow)) >>> 0
	const windowBytes = Math.min(section.end - alignedWindowStart + 1, MAX_WINDOW_ROWS * bytesPerRow)
	const totalRows = Math.max(1, Math.ceil(windowBytes / bytesPerRow))
	const windowEnd = (alignedWindowStart + windowBytes - 1) >>> 0

	// Fixed-size row pool: the slot count only changes on resize, so scrolling
	// rewrites the contents of the same row elements instead of remounting them.
	const visibleRows = Math.min(totalRows, Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN_ROWS * 2)
	const firstRow = Math.max(0, Math.min(Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS, totalRows - visibleRows))

	// Anchors the window at the section start whenever the address is near it, so
	// the rows above stay reachable, and only re-anchors for a distant address.
	const revealAddress = React.useCallback((address: number) => {
		const target = sectionForAddress(address)
		if (!target) return false
		const span = MAX_WINDOW_ROWS * bytesPerRow
		setAddressError(null)
		setSectionId(target.id)
		setAddressInput(formatAddress(address))
		setWindowStart(address - target.start < span ? target.start : Math.max(target.start, address - Math.floor(span / 2)))
		setPendingReveal(address)
		return true
	}, [bytesPerRow])

	// A selected call stack frame brings its return address into view.
	React.useEffect(() => {
		if (focusAddress === null) {
			focusedRef.current = null
			return
		}
		if (focusAddress === focusedRef.current) return
		focusedRef.current = focusAddress
		revealAddress(focusAddress)
	}, [focusAddress, revealAddress])

	// Scrolls to a revealed address once the window that contains it is in place.
	React.useEffect(() => {
		if (pendingReveal === null || !scrollRef.current) return
		const row = Math.floor((pendingReveal - alignedWindowStart) / bytesPerRow)
		if (row < 0 || row >= totalRows) return
		scrollRef.current.scrollTop = Math.max(0, row * ROW_HEIGHT - Math.max(0, viewport.height / 2 - ROW_HEIGHT))
		setPendingReveal(null)
	}, [alignedWindowStart, bytesPerRow, pendingReveal, totalRows, viewport.height])

	const rows = React.useMemo<MemoryRowData[]>(() => Array.from({ length: Math.max(0, visibleRows) }, (unused, index) => {
		const rowAddress = (alignedWindowStart + (firstRow + index) * bytesPerRow) >>> 0
		const bytes = Array.from({ length: bytesPerRow }, (unusedByte, offset) => {
			const address = (rowAddress + offset) >>> 0
			return { address, value: byteAt(memory, address) }
		})
		const groups = Array.from({ length: bytesPerRow / groupSize }, (unusedGroup, groupIndex) => {
			const groupBytes = bytes.slice(groupIndex * groupSize, (groupIndex + 1) * groupSize)
			const digits = [...groupBytes].reverse().map((byte) => toHex(byte.value)).join('')
			const significant = digits.replace(/^0+/, '')
			return {
				start: groupBytes[0].address,
				bytes: groupBytes,
				// Only a word can hold a saved return address.
				value: groupBytes.length === 4 ? Number.parseInt(digits, 16) >>> 0 : null,
				zero: significant.length === 0,
				// An all-zero group keeps its final digit, so something stays readable.
				leadingZeros: significant.length === 0 ? digits.length - 1 : digits.length - significant.length,
			}
		})
		return { address: rowAddress, groups, bytes }
	}), [alignedWindowStart, bytesPerRow, firstRow, groupSize, memory, visibleRows])

	const handleHover = (event: React.MouseEvent<HTMLDivElement>) => {
		const target = (event.target as HTMLElement).closest<HTMLElement>('[data-address]')
		if (!target) {
			clearHover()
			return
		}
		const start = Number(target.dataset.address)
		const size = Number(target.dataset.size ?? 1)
		if (hover && hover.start === start && hover.size === size) return
		const rect = target.getBoundingClientRect()
		setHover({ start, size, rect: { left: rect.left, top: rect.top, bottom: rect.bottom } })
		onHoverAddress(size === 4 && start >= TEXT_SECTION.start && start <= TEXT_SECTION.end ? start : null)
	}

	const clearHover = () => {
		setHover(null)
		onHoverAddress(null)
	}

	const tooltip = React.useMemo(() => {
		if (!hover) return null
		const bytes = Array.from({ length: hover.size }, (unused, offset) => byteAt(memory, (hover.start + offset) >>> 0))
		const value = groupValue(bytes)
		const signed = BigInt.asIntN(hover.size * 8, value)
		const range = hover.size > 1
			? `${formatAddress(hover.start)} - ${formatAddress(hover.start + hover.size - 1)}`
			: formatAddress(hover.start)
		const text = bytes.map(toPrintable).join('')
		// Words in .text decode to an instruction; other widths and sections do not.
		const inText = hover.start >= TEXT_SECTION.start && hover.start <= TEXT_SECTION.end
		const assembly = hover.size === 4 && inText ? disassemble(Number(value), hover.start) : null
		return {
			range,
			hex: `0x${[...bytes].reverse().map(toHex).join('')}`,
			unsigned: value.toString(),
			signed: signed === value ? null : signed.toString(),
			ascii: hover.size > 1 ? `"${text}"` : `'${text}'`,
			assembly,
		}
	}, [hover, memory])

	const showSection = (target: MemorySection) => {
		setAddressError(null)
		setSectionId(target.id)
		setWindowStart(target.start)
		setAddressInput(formatAddress(target.start))
		if (scrollRef.current) scrollRef.current.scrollTop = 0
	}

	const goToAddress = () => {
		const address = parseWord(addressInput)
		if (address === null || address < 0 || address > 0xffffffff) {
			setAddressError('Enter a valid 32-bit address')
			return
		}
		if (!revealAddress(address >>> 0)) setAddressError('Address is outside every memory section')
	}

	return (
		<div className="memory-view">
			<span className="memory-probe" ref={probeRef}>00000000000000000000</span>

			<div className="memory-sections">
				{SECTIONS.map((entry) => (
					<button
						key={entry.id}
						className={`memory-section ${entry.id === section.id ? 'active' : ''}`}
						title={`${formatAddress(entry.start)} - ${formatAddress(entry.end)}`}
						onClick={() => showSection(entry)}
					>
						{entry.label}
					</button>
				))}
				<span className="memory-status">
					{formatAddress(alignedWindowStart)} - {formatAddress(windowEnd)}
					{windowEnd < section.end && ' (windowed; use Go to move)'}
				</span>
			</div>

			<div className="memory-controls">
				<div className="memory-group-sizes">
					{GROUP_SIZES.map((size) => (
						<button
							key={size}
							className={`memory-group-size ${size === groupSize ? 'active' : ''}`}
							title={`${size}-byte groups`}
							onClick={() => setGroupSize(size)}
						>
							{size}
						</button>
					))}
				</div>
				<div className="memory-toggles">
					<button
						className={`memory-toggle ${powerOfTwoRows ? 'active' : ''}`}
						title="Wrap rows at a power of two bytes"
						onClick={(event) => setRowOptions((current) => nextToggles(current, 'powerOfTwo', event))}
					>
						^2
					</button>
					<button
						className={`memory-toggle ${showAscii ? 'active' : ''}`}
						title="Show the ASCII column"
						onClick={(event) => setRowOptions((current) => nextToggles(current, 'ascii', event))}
					>
						ascii
					</button>
				</div>
				<input
					className="memory-address-input"
					type="text"
					value={addressInput}
					onChange={(event) => setAddressInput(event.target.value)}
					onKeyDown={(event) => { if (event.key === 'Enter') goToAddress() }}
					placeholder="0x10010000"
				/>
				<button className="memory-go" onClick={goToAddress}>Go</button>
			</div>
			{addressError && <div className="memory-error">{addressError}</div>}

			<div className="memory-grid" ref={scrollRef} onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); clearHover() }}>
				<div className="memory-scroll" style={{ height: totalRows * ROW_HEIGHT }}>
					<div
						className="memory-rows"
						onMouseOver={handleHover}
						onMouseLeave={clearHover}
					>
						<span className="memory-origin" ref={originRef} />
						{rows.map((row, slot) => (
							<MemoryRow
								key={slot}
								row={row}
								top={frame.top + (firstRow + slot) * ROW_HEIGHT - scrollTop}
								left={frame.left}
								width={frame.width}
								groupSize={groupSize}
								showAscii={showAscii}
								pc={groupSize === 4 ? pc : null}
								returnAddresses={returnAddresses}
								hover={hover && hover.start >= row.address && hover.start < row.address + bytesPerRow ? hover : null}
							/>
						))}
					</div>
				</div>
			</div>

			{hover && tooltip && (
				<div
					className="memory-tooltip"
					style={hover.rect.top < 96
						? { left: hover.rect.left, top: hover.rect.bottom + 4 }
						: { left: hover.rect.left, top: hover.rect.top - 4, transform: 'translateY(-100%)' }}
				>
					<div className="memory-tooltip-range">{tooltip.range}</div>
					<div><span>hex</span><HexNumber text={tooltip.hex} /></div>
					<div><span>dec</span>{tooltip.unsigned}</div>
					{tooltip.signed && <div><span>signed</span>{tooltip.signed}</div>}
					<div><span>ascii</span>{tooltip.ascii}</div>
					{tooltip.assembly && <div><span>asm</span>{tooltip.assembly}</div>}
				</div>
			)}

		</div>
	)
}

export default MemoryView

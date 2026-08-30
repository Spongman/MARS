import React from 'react'
import './RegisterView.css'
import { bitsToDouble, bitsToSingle, CP0_REGISTERS, formatDouble, formatSingle } from '../core/coprocessor'
import { formatWord } from '../core/format'
import type { CoprocessorState, Registers } from '../core/types'
import { advanceOne, isSolo, nextToggles } from './toggleGroup'
import FloatBitsView from './FloatBitsView'
import HexNumber from './HexNumber'
import { isOneOf, useStoredState } from '../hooks/useStoredState'

interface RegisterViewProps extends CoprocessorState { registers: Registers }

type RegisterTab = 'registers' | 'coproc1' | 'coproc0'

type Format = '0n' | '0x' | 'f' | 'd'

const TABS: Array<{ id: RegisterTab; label: string }> = [
	{ id: 'registers', label: 'Registers' },
	{ id: 'coproc1', label: 'Coproc 1' },
	{ id: 'coproc0', label: 'Coproc 0' },
]

const FORMATS: Array<{ id: Format; title: string }> = [
	{ id: '0n', title: 'Decimal' },
	{ id: '0x', title: 'Hexadecimal' },
	{ id: 'f', title: 'Single precision float' },
	{ id: 'd', title: 'Double precision float, paired with the next register' },
]

const REGISTER_GROUPS: Record<string, string[]> = {
	'Zero/At': ['$zero', '$at'],
	'Return Values': ['$v0', '$v1'],
	'Arguments': ['$a0', '$a1', '$a2', '$a3'],
	'Temporaries': ['$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7'],
	'Saved': ['$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7'],
	'More Temps': ['$t8', '$t9'],
	'Reserved': ['$k0', '$k1'],
	'Pointers': ['$gp', '$sp', '$fp', '$ra'],
	'Special': ['$pc', '$hi', '$lo'],
}

/** Widest rendering of each format at the list font, in pixels. */
const FORMAT_WIDTHS: Record<Format, number> = { '0n': 72, '0x': 72, 'f': 94, 'd': 130 }

/** Advance of the monospace list font at 12px, which names are measured in. */
const NAME_CHAR_WIDTH = 7.2
const MIN_NAME_WIDTH = 48

const hex = formatWord

type FormatFlags = Record<Format, boolean>

const flagsFrom = (formats: Format[]): FormatFlags =>
	Object.fromEntries(FORMATS.map((format) => [format.id, formats.includes(format.id)])) as FormatFlags

const FLOATING_POINT = 'Floating Point'
const SYSTEM_CONTROL = 'System Control'

const INTEGER_FORMATS: Format[] = ['0n', '0x']
/** A float's bits say nothing as a decimal, so the FPU file offers neither. */
const FLOAT_FORMATS: Format[] = ['f', 'd']

const formatsFor = (panel: string) => panel === FLOATING_POINT ? FLOAT_FORMATS : INTEGER_FORMATS

/**
 * Single and double are two readings of the same registers rather than two
 * columns of one, so the FPU file switches between them instead of showing
 * both: in double, each register pairs with the odd one after it.
 */
const isExclusive = (panel: string) => panel === FLOATING_POINT

/** The radixes a panel is showing, which for an exclusive panel is exactly one. */
const activeFormats = (panel: string, flags: FormatFlags): Format[] => {
	const available = formatsFor(panel)
	const active = available.filter((format) => flags[format])
	return isExclusive(panel) ? [active[0] ?? available[0]] : active
}

/** Panels of one processor, which is as far as a shift-click reaches. */
const TAB_PANELS: Record<RegisterTab, string[]> = {
	registers: Object.keys(REGISTER_GROUPS),
	coproc1: [FLOATING_POINT],
	coproc0: [SYSTEM_CONTROL],
}

/** Every known panel must carry its four flags, with at least one turned on. */
const isPanelFormats = (value: unknown) =>
	typeof value === 'object' && value !== null &&
	Object.keys(INITIAL_PANEL_FORMATS).every((panel) => {
		const flags = (value as Record<string, unknown>)[panel]
		if (typeof flags !== 'object' || flags === null) return false
		const entries = FORMATS.map((format) => (flags as Record<string, unknown>)[format.id])
		return entries.every((flag) => typeof flag === 'boolean') && entries.some(Boolean)
	})

const INITIAL_PANEL_FORMATS: Record<string, FormatFlags> = {
	...Object.fromEntries(Object.keys(REGISTER_GROUPS).map((group) => [group, flagsFrom(['0x'])])),
	[FLOATING_POINT]: flagsFrom(['f']),
	[SYSTEM_CONTROL]: flagsFrom(['0x']),
}

interface RegisterEntry {
	name: string
	bits: number
	/** High word of the double this register starts, when it starts one. */
	highBits?: number
}

const formatBits = (format: Format, entry: RegisterEntry) => {
	switch (format) {
		case '0n': return `${entry.bits >>> 0}`
		case '0x': return hex(entry.bits)
		case 'f': return formatSingle(bitsToSingle(entry.bits))
		case 'd': return entry.highBits === undefined ? '' : formatDouble(bitsToDouble(entry.bits, entry.highBits))
	}
}

function RegisterPanel({ title, entries, flags, onToggle, selected, onSelect }: {
	title: string
	entries: RegisterEntry[]
	flags: FormatFlags
	onToggle: (title: string, format: Format, event: React.MouseEvent) => void
	/** Name of the entry whose bits are being inspected, where that is offered. */
	selected?: string
	onSelect?: (name: string) => void
}) {
	const available = formatsFor(title)
	const formats = activeFormats(title, flags)

	// Columns are only as wide as the names and the visible radixes need.  CP0
	// names carry what the register is for, which is wider than a `$t0`.
	const nameWidth = Math.ceil(Math.max(MIN_NAME_WIDTH, ...entries.map((entry) => entry.name.length * NAME_CHAR_WIDTH)))
	const columnWidth = nameWidth + 24 + formats.reduce((total, format) => total + FORMAT_WIDTHS[format] + 8, 0)

	return (
		<div className="register-group">
			<div className="group-title">
				<span>{title}</span>
				<div className="format-toggles">
					{FORMATS.filter((format) => available.includes(format.id)).map((format) => (
						<button
							key={format.id}
							className={`format-toggle${formats.includes(format.id) ? ' active' : ''}`}
							title={format.title}
							onClick={(event) => onToggle(title, format.id, event)}
						>
							{format.id}
						</button>
					))}
				</div>
			</div>
			<div className="register-list" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${columnWidth}px, 1fr))` }}>
				{entries.map((entry) => (
					<div
						key={entry.name}
						className={`register-item${onSelect ? ' register-item-selectable' : ''}${entry.name === selected ? ' selected' : ''}`}
						style={{ gridTemplateColumns: `minmax(${nameWidth}px, auto) repeat(${formats.length}, 1fr)` }}
						onClick={onSelect && (() => onSelect(entry.name))}
						role={onSelect && 'button'}
						tabIndex={onSelect && 0}
						onKeyDown={onSelect && ((event) => {
							if (event.key !== 'Enter' && event.key !== ' ') return
							event.preventDefault()
							onSelect(entry.name)
						})}
					>
						<span className="reg-name">{entry.name}</span>
						{formats.map((format) => {
							const text = formatBits(format, entry)
							return (
								<span key={format} className="reg-value" title={text}>
									{format === '0x' ? <HexNumber text={text} /> : text}
								</span>
							)
						})}
					</div>
				))}
			</div>
		</div>
	)
}

function RegisterView({ registers, fpRegisters, fpConditionFlags, cp0Registers }: RegisterViewProps) {
	const [tab, setTab] = useStoredState<RegisterTab>('registers.tab', 'registers', isOneOf(TABS.map((item) => item.id)))
	const [panelFormats, setPanelFormats] = useStoredState('registers.formats', INITIAL_PANEL_FORMATS, isPanelFormats)
	/** Index of the CP1 register whose IEEE-754 fields are shown, if any. */
	const [selectedRegister, setSelectedRegister] = React.useState<number | null>(null)
	const fpDouble = activeFormats(FLOATING_POINT, panelFormats[FLOATING_POINT])[0] === 'd'
	// A double is read from a register pair, so a selected odd register belongs
	// to the pair before it once the file is being read that way.
	const selectedFp = selectedRegister === null ? null : fpDouble ? selectedRegister & ~1 : selectedRegister

	const handleToggle = React.useCallback((panel: string, format: Format, event: React.MouseEvent) => {
		setPanelFormats((current) => {
			// One format always stays on: an entry with no value column says nothing,
			// so turning off the last one moves to the next radix instead.  An
			// exclusive panel simply moves to the radix that was clicked.
			const clicked = isExclusive(panel)
				? flagsFrom([format])
				: advanceOne(nextToggles(current[panel], format, event), format, formatsFor(panel))
			if (!event.shiftKey) return { ...current, [panel]: clicked }
			// Shift-click lands the same change on the other panels of this processor.
			const siblings = TAB_PANELS[tab]
			return Object.fromEntries(Object.entries(current).map(([name, flags]) => {
				if (name === panel) return [name, clicked]
				if (!siblings.includes(name)) return [name, flags]
				return [name, isSolo(event) ? { ...clicked } : advanceOne({ ...flags, [format]: clicked[format] }, format, formatsFor(name))]
			}))
		})
	}, [tab])

	return (
		<div className="register-view">
			<div className="register-tabs">
				{TABS.map((item) => (
					<button
						key={item.id}
						className={`register-tab${tab === item.id ? ' active' : ''}`}
						onClick={() => setTab(item.id)}
					>
						{item.label}
					</button>
				))}
			</div>

			{tab === 'registers' && Object.entries(REGISTER_GROUPS).map(([group, names]) => (
				<RegisterPanel
					key={group}
					title={group}
					flags={panelFormats[group]}
					onToggle={handleToggle}
					entries={names.map((name, index) => ({
						name,
						bits: registers[name] || 0,
						highBits: index + 1 < names.length ? registers[names[index + 1]] || 0 : undefined,
					}))}
				/>
			))}

			{tab === 'coproc1' && (
				<>
					<div className="register-group">
						<div className="group-title"><span>Condition Flags</span></div>
						<div className="register-list">
							{fpConditionFlags.map((flag, index) => (
								<div key={index} className="register-item register-item-flag">
									<span className="reg-name">{`cc${index}`}</span>
									<span className="reg-value">{flag ? '1' : '0'}</span>
								</div>
							))}
						</div>
					</div>

					<RegisterPanel
						title={FLOATING_POINT}
						flags={panelFormats[FLOATING_POINT]}
						onToggle={handleToggle}
						selected={selectedFp === null ? undefined : `$f${selectedFp}`}
						onSelect={(name) => {
							const index = Number(name.slice(2))
							setSelectedRegister((current) => current === index ? null : index)
						}}
						// Doubles live in an even/odd pair, so only even registers start
						// one and the odd half of the file has nothing of its own to show.
						entries={fpRegisters
							.map((bits, index) => ({ name: `$f${index}`, bits, highBits: index % 2 === 0 ? fpRegisters[index + 1] || 0 : undefined }))
							.filter((_, index) => !fpDouble || index % 2 === 0)}
					/>

					{selectedFp !== null && (
						<div className="register-group">
							<div className="group-title">
								<span>{`$f${selectedFp}${fpDouble ? `/$f${selectedFp + 1}` : ''} bits`}</span>
								<button className="format-toggle" title="Clear selection" onClick={() => setSelectedRegister(null)}>×</button>
							</div>
							<FloatBitsView bits={fpRegisters[selectedFp] >>> 0} highBits={fpDouble ? fpRegisters[selectedFp + 1] >>> 0 : undefined} />
						</div>
					)}
				</>
			)}

			{tab === 'coproc0' && (
				<RegisterPanel
					title={SYSTEM_CONTROL}
					flags={panelFormats[SYSTEM_CONTROL]}
					onToggle={handleToggle}
					entries={CP0_REGISTERS.map(({ index, name }) => ({ name, bits: cp0Registers[index] || 0 }))}
				/>
			)}
		</div>
	)
}

export default RegisterView

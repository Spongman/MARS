import React from 'react'
import { EXAMPLES } from '../examples'
import { menuLabel, panelsIn, type PanelSpec } from './panels'
import './MainMenu.css'

/**
 * The workspace menu: everything that is not a running control.
 *
 * The toolbar keeps the buttons a run is driven with and nothing else, so what
 * is used once a session lives here instead of competing with what is used
 * every few seconds.
 */

interface MainMenuProps {
	onSettings: () => void
	onLoadExample: (code: string) => void
	onOpenPanel: (id: string) => void
	/** Panels already on screen, shown as such rather than offered again. */
	openPanels: readonly string[]
}

type Submenu = 'examples' | 'window' | 'tools'

function MainMenu({ onSettings, onLoadExample, onOpenPanel, openPanels }: MainMenuProps) {
	const [open, setOpen] = React.useState(false)
	const [submenu, setSubmenu] = React.useState<Submenu | null>(null)
	const menuRef = React.useRef<HTMLDivElement>(null)

	const close = React.useCallback(() => {
		setOpen(false)
		setSubmenu(null)
	}, [])

	// Dismissed by a click anywhere else, or by Escape.
	React.useEffect(() => {
		if (!open) return
		const onPointerDown = (event: PointerEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) close()
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close()
		}
		document.addEventListener('pointerdown', onPointerDown)
		document.addEventListener('keydown', onKeyDown)
		return () => {
			document.removeEventListener('pointerdown', onPointerDown)
			document.removeEventListener('keydown', onKeyDown)
		}
	}, [open, close])

	/**
	 * A panel to open.  A tool carries the line that says what it watches, since
	 * this menu is where one is chosen and there is no page about them any more.
	 */
	const panelItem = (panel: PanelSpec) => {
		const shown = openPanels.includes(panel.id)
		return (
			<button
				key={panel.id}
				className={`menu-item menu-item-tick${panel.description ? ' menu-item-described' : ''}`}
				role="menuitem"
				onClick={() => { onOpenPanel(panel.id); close() }}
				// Already open still selects it: the tab may be behind another.
				title={shown ? `${menuLabel(panel)} is open; bring it forward` : `Open ${menuLabel(panel)}`}
			>
				<span className="item-name">
					<span className="menu-check" aria-hidden="true">{shown ? '✓' : ''}</span>
					{menuLabel(panel)}
				</span>
				{panel.description && <span className="item-desc">{panel.description}</span>}
			</button>
		)
	}

	/** `wide` is for the lists whose items carry a line of prose under the name. */
	const section = (key: Submenu, label: string, items: React.ReactNode, wide = false) => (
		<div
			className={`menu-section${submenu === key ? ' expanded' : ''}`}
			onMouseEnter={() => setSubmenu(key)}
		>
			<button
				className="menu-item menu-parent"
				role="menuitem"
				aria-haspopup="menu"
				aria-expanded={submenu === key}
				onClick={() => setSubmenu(submenu === key ? null : key)}
			>
				{label}
				<span className="menu-arrow" aria-hidden="true">›</span>
			</button>
			{submenu === key && <div className={`menu-flyout${wide ? ' menu-flyout-wide' : ''}`} role="menu">{items}</div>}
		</div>
	)

	return (
		<div className="main-menu" ref={menuRef}>
			<button
				className={`btn btn-icon${open ? ' btn-active' : ''}`}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label="Menu"
				title="Menu"
				onClick={() => (open ? close() : setOpen(true))}
			>
				☰
			</button>

			{open && (
				<div className="menu-panel" role="menu">
					<button
						className="menu-item"
						role="menuitem"
						onMouseEnter={() => setSubmenu(null)}
						onClick={() => { onSettings(); close() }}
					>
						Settings…
					</button>

					<div className="menu-separator" />

					{section('examples', 'Examples', Object.entries(EXAMPLES).map(([key, example]) => (
						<button
							key={key}
							className="menu-item menu-item-described"
							role="menuitem"
							onClick={() => { onLoadExample(example.code); close() }}
						>
							<span className="item-name">{example.name}</span>
							<span className="item-desc">{example.description}</span>
						</button>
					)), true)}

					{section('window', 'Window', panelsIn('window').map(panelItem))}
					{section('tools', 'Tools', panelsIn('tool').map(panelItem), true)}
				</div>
			)}
		</div>
	)
}

export default MainMenu

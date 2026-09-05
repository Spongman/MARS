import React from 'react'
import './PanelGroup.css'

interface PanelGroupProps {
	/** Names the section, in the bar across the top of the box. */
	title?: React.ReactNode
	/** Controls belonging to the section, at the right of that bar. */
	actions?: React.ReactNode
	/**
	 * Set where the children lay themselves out edge to edge, as a list or a
	 * table does, rather than sitting in the box with room around them.
	 */
	flush?: boolean
	className?: string
	children?: React.ReactNode
}

/**
 * The workspace's one section box: bordered and rounded, under a title bar.
 *
 * The register panel is built of these, and the tool panels are too, so a tool
 * reads as part of the workspace rather than as a window of its own.
 */
export default function PanelGroup({ title, actions, flush, className, children }: PanelGroupProps) {
	return (
		<section className={`panel-group${className ? ` ${className}` : ''}`}>
			{(title !== undefined || actions !== undefined) && (
				<div className="panel-group-title">
					<span>{title}</span>
					{actions}
				</div>
			)}
			<div className={`panel-group-body${flush ? ' panel-group-flush' : ''}`}>{children}</div>
		</section>
	)
}

import React from 'react'
import { disassemble } from '../core/disassembler'
import { formatWord, memoryKey } from '../core/format'
import type { MemoryView } from '../core/types'
import { DatapathAnimation, staticWires, TRACK_WIDTH, xrayLabels } from '../tools/xray/animation'
import { geometryOf } from '../tools/xray/geometry'
import type { XrayArrow } from '../tools/xray/geometry'
import { XRAY_DATAPATHS } from '../tools/xray/datapaths'
import type { XrayDiagram } from '../tools/xray/datapaths'
import { XRAY_DRAWINGS } from '../tools/xray/blocks'
import type { XrayBlock } from '../tools/xray/blocks'
import { isOneOf, useStoredState } from '../hooks/useStoredState'
import './MipsXrayView.css'

interface Props {
	memory: MemoryView
	pc: number
}

const DIAGRAMS: { key: XrayDiagram; label: string }[] = [
	{ key: 'datapath', label: 'Datapath' },
	{ key: 'control', label: 'Control unit' },
	{ key: 'aluControl', label: 'ALU control' },
	{ key: 'register', label: 'Register bank' },
]

/** Pixels of wire drawn per frame, so a whole datapath lights up in a second or so. */
const SPEEDS = [1, 2, 4, 8, 16]

/** A junction dot, wide enough to cover the wires meeting under it. */
const JUNCTION_RADIUS = 3

/** The head THRAX draws where a value arrives at a block: length, then width. */
const ARROW = { length: 9, width: 8 }

/** The head as a triangle, its point on the block and its back along the wire. */
function arrowPoints({ x, y, dx, dy }: Omit<XrayArrow, 'index'>): string {
	const [backX, backY] = [x - dx * ARROW.length, y - dy * ARROW.length]
	const [sideX, sideY] = [(dy * ARROW.width) / 2, (dx * ARROW.width) / 2]
	return `${x},${y} ${backX + sideX},${backY + sideY} ${backX - sideX},${backY - sideY}`
}

/** The inverting bubble on a gate input. */
const BUBBLE_RADIUS = 3.5

/** Only the main drawing carries the instruction annotations THRAX writes. */
const ANNOTATED: XrayDiagram = 'datapath'

/** The notched arrow MIPS diagrams use for an adder or the ALU. */
function aluPath({ x, y, width: w, height: h }: XrayBlock): string {
	return [
		`M ${x} ${y}`,
		`L ${x + w} ${y + h * 0.3}`,
		`L ${x + w} ${y + h * 0.7}`,
		`L ${x} ${y + h}`,
		`L ${x} ${y + h * 0.62}`,
		`L ${x + w * 0.3} ${y + h * 0.5}`,
		`L ${x} ${y + h * 0.38}`,
		'Z',
	].join(' ')
}

/** A flat back and a half-round nose, pointing right or down. */
function andPath({ x, y, width: w, height: h, facing }: XrayBlock): string {
	if (facing === 'down') {
		return `M ${x} ${y} H ${x + w} V ${y + h - w / 2} A ${w / 2} ${w / 2} 0 0 1 ${x} ${y + h - w / 2} Z`
	}
	return `M ${x} ${y} H ${x + w - h / 2} A ${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h} H ${x} Z`
}

/** A dished back and a pointed nose. */
function orPath({ x, y, width: w, height: h }: XrayBlock): string {
	return [
		`M ${x} ${y}`,
		`Q ${x + w * 0.4} ${y + h / 2} ${x} ${y + h}`,
		`Q ${x + w * 0.7} ${y + h * 0.92} ${x + w} ${y + h / 2}`,
		`Q ${x + w * 0.7} ${y + h * 0.08} ${x} ${y}`,
		'Z',
	].join(' ')
}

function Block({ block }: { block: XrayBlock }) {
	const { shape, x, y, width, height, label, labelSize = 10, rows } = block
	const centreX = x + width / 2
	const centreY = y + height / 2

	const text = label && (
		<text className="xray-block-label" x={centreX} y={centreY} fontSize={labelSize}>
			{label.map((line, index) => (
				<tspan key={line + index} x={centreX} dy={index === 0 ? -((label.length - 1) * labelSize * 1.15) / 2 : labelSize * 1.15}>
					{line}
				</tspan>
			))}
		</text>
	)

	switch (shape) {
		case 'panel':
			return <rect className="xray-panel" x={x} y={y} width={width} height={height} rx={4} />
		case 'rect':
			return (
				<g>
					<rect className="xray-block" x={x} y={y} width={width} height={height} rx={2} />
					{text}
				</g>
			)
		case 'pill':
			return (
				<g>
					<rect className="xray-block" x={x} y={y} width={width} height={height} rx={width / 2} />
					{text}
				</g>
			)
		case 'ellipse':
			return (
				<g>
					<ellipse className="xray-block" cx={centreX} cy={centreY} rx={width / 2} ry={height / 2} />
					{text}
				</g>
			)
		case 'alu':
			return (
				<g>
					<path className="xray-block" d={aluPath(block)} />
					{text}
					{block.note && (
						<text className="xray-block-note" x={x + width * 0.5} y={y + height * 0.32} fontSize={7}>
							{block.note}
						</text>
					)}
				</g>
			)
		case 'and':
			return <path className="xray-gate" d={andPath(block)} />
		case 'or':
		case 'nor':
			return (
				<g>
					<path className="xray-gate" d={orPath(block)} />
					{/*
						An inverting bubble sits on the gate's own edge, which is
						dished: at a fraction `at` of the way down, the curve has
						come 0.8 * width * at * (1 - at) in from the left.
					*/}
					{shape === 'nor' && [0.28, 0.72].map((at) => (
						<circle
							key={at}
							className="xray-gate"
							cx={x + width * 0.8 * at * (1 - at) - BUBBLE_RADIUS}
							cy={y + height * at}
							r={BUBBLE_RADIUS}
						/>
					))}
				</g>
			)
		case 'rows':
			return (
				<g>
					<rect className="xray-block" x={x} y={y} width={width} height={height} rx={2} />
					{rows?.map((row, index) => {
						const rowHeight = height / rows.length
						const top = y + index * rowHeight
						return (
							<g key={row + index}>
								{index > 0 && <line className="xray-block-rule" x1={x} y1={top} x2={x + width} y2={top} />}
								<text className="xray-block-caption" x={x + 5} y={top + rowHeight * 0.35} fontSize={6}>CTRL</text>
								<text className="xray-block-caption" x={x + 5} y={top + rowHeight * 0.75} fontSize={6}>DATA</text>
								<text className="xray-block-label" x={x + width * 0.6} y={top + rowHeight / 2} fontSize={block.labelSize ?? 12}>
									{row}
								</text>
							</g>
						)
					})}
				</g>
			)
	}
}

function MipsXrayView({ memory, pc }: Props) {
	const [diagram, setDiagram] = useStoredState<XrayDiagram>('xray.diagram', 'datapath', isOneOf(DIAGRAMS.map((entry) => entry.key)))
	const [speed, setSpeed] = useStoredState('xray.speed', 4, isOneOf(SPEEDS))
	const [, setFrame] = React.useState(0)

	const word = memory[memoryKey(pc)] ?? 0
	const datapath = XRAY_DATAPATHS[diagram]
	const drawing = XRAY_DRAWINGS[diagram]
	const wires = React.useMemo(() => staticWires(diagram), [diagram])
	// The blocks come from the geometry, which settles them into place.
	const { arrows, junctions, blocks } = React.useMemo(() => geometryOf(diagram), [diagram])

	// A fresh animation whenever the instruction or the drawing changes.
	const animation = React.useMemo(() => new DatapathAnimation(diagram, word), [diagram, word])

	React.useEffect(() => {
		let handle = 0
		const tick = () => {
			if (!animation.done) {
				animation.advance(speed)
				setFrame((frame) => frame + 1)
			}
			handle = requestAnimationFrame(tick)
		}
		handle = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(handle)
	}, [animation, speed])

	const text = disassemble(word, pc)

	return (
		<div className="tool tool-fills xray">
			<div className="tool-settings">
				<label>
					Diagram
					<select value={diagram} onChange={(event) => setDiagram(event.target.value as XrayDiagram)}>
						{DIAGRAMS.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
					</select>
				</label>
				<label>
					Speed
					<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
						{SPEEDS.map((value) => <option key={value} value={value}>{value}x</option>)}
					</select>
				</label>
				<button className="btn btn-secondary" onClick={() => { animation.reset(); setFrame((frame) => frame + 1) }}>Replay</button>
				<span className="xray-instruction">
					{formatWord(pc)}
					{text ? ` ${text}` : ' (no instruction)'}
				</span>
			</div>

			<div className="xray-scroll">
				<svg
					className="xray-drawing"
					viewBox={`0 0 ${datapath.width} ${datapath.height}`}
					preserveAspectRatio="xMidYMid meet"
					role="img"
					aria-label={`MIPS datapath for ${text ?? 'no instruction'}`}
				>
					{blocks.filter((block) => block.shape === 'panel').map((block, index) => <Block key={index} block={block} />)}

					<g className="xray-wires" strokeWidth={TRACK_WIDTH}>
						{wires.map((wire) => (
							<line key={wire.index} x1={wire.x1} y1={wire.y1} x2={wire.x2} y2={wire.y2} />
						))}
					</g>

					{/* A head where a value arrives at a block, as THRAX marks it. */}
					<g className="xray-arrows">
						{arrows.map((arrow, index) => <polygon key={index} points={arrowPoints(arrow)} />)}
					</g>

					{/* A dot marks where wires tap off one another, over the joins. */}
					<g className="xray-junctions">
						{junctions.map((junction, index) => (
							<circle key={index} cx={junction.x} cy={junction.y} r={JUNCTION_RADIUS} />
						))}
					</g>

					<g className="xray-live" strokeWidth={TRACK_WIDTH}>
						{animation.segments().map((segment) => (
							<line key={segment.index} stroke={segment.color} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}>
								<title>{segment.name}</title>
							</line>
						))}
					</g>

					<g className="xray-arrows-live">
						{animation.litArrows().map((arrow, index) => (
							<polygon key={index} points={arrowPoints(arrow)} fill={arrow.color} />
						))}
					</g>

					{/* Its own class: a fill rule would beat the colour set here. */}
					<g className="xray-junctions-live">
						{animation.litJunctions().map((junction, index) => (
							<circle key={index} cx={junction.x} cy={junction.y} r={JUNCTION_RADIUS} fill={junction.color} />
						))}
					</g>

					{blocks.filter((block) => block.shape !== 'panel').map((block, index) => <Block key={index} block={block} />)}

					{drawing.texts.map((entry, index) => (
						<text
							key={index}
							className={entry.strong ? 'xray-caption xray-caption-strong' : 'xray-caption'}
							x={entry.x}
							y={entry.y}
							fontSize={entry.size ?? 12}
							textAnchor={entry.anchor ?? 'start'}
						>
							{entry.text}
						</text>
					))}

					{diagram === ANNOTATED && xrayLabels(word).map((label, index) => (
						<text
							key={index}
							className={label.bold ? 'xray-annotation xray-annotation-title' : 'xray-annotation'}
							x={label.x}
							y={label.y}
							fill={label.color}
							fontSize={label.size}
						>
							{label.text}
						</text>
					))}
				</svg>
			</div>
		</div>
	)
}

export default MipsXrayView

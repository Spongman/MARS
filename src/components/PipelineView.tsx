import { formatWord } from '../core/format'
import { REGISTER_NAMES } from '../core/registers'
import type { BranchResolution, DataHazardPolicy, JumpResolution, PipelineRow, PipelineSettings, PipelineSnapshot, PredictionScheme } from '../tools/pipeline'
import PanelGroup from './PanelGroup'
import './ToolPanels.css'

interface Props {
	pipeline: PipelineSnapshot
	settings: PipelineSettings
	onChange: (settings: PipelineSettings) => void
}

const WINDOW_SIZES = [8, 16, 24, 40, 64]

/** What the instruction is doing on `cycle`, or null when it is not in flight. */
function cellFor(row: PipelineRow, cycle: number): { label: string; kind: string } | null {
	const [fetch, decodeAt, execute, memory, write] = row.cycles

	if (cycle === write) return { label: 'WB', kind: 'wb' }
	if (cycle === memory) return { label: 'MEM', kind: 'mem' }
	if (cycle === execute) return { label: 'EX', kind: 'ex' }
	// Cycles beyond the first in a stage are the bubble the hazard opened up.
	if (cycle === decodeAt) return { label: 'ID', kind: 'id' }
	if (cycle > decodeAt && cycle < execute) return { label: '•', kind: 'stall' }
	if (cycle === fetch) return { label: 'IF', kind: 'if' }
	if (cycle > fetch && cycle < decodeAt) return { label: '•', kind: 'stall' }
	return null
}

/** The branch decision the front end made, for the row's tooltip. */
function describePrediction(row: PipelineRow): string {
	if (row.predicted === null) return row.mispredicted ? 'taken, and nothing predicted it' : ''
	const guess = row.predicted ? 'taken' : 'not taken'
	return row.mispredicted ? `predicted ${guess}, and was wrong` : `predicted ${guess}, correctly`
}

function describeStall(row: PipelineRow): string {
	if (row.stalls === 0) return ''
	const register = row.blockedOn === null ? 'an earlier result' : REGISTER_NAMES[row.blockedOn] ?? `$${row.blockedOn}`
	const reason = row.cause === 'load-use' ? 'load-use hazard' : 'data hazard'
	return `${row.stalls} cycle${row.stalls === 1 ? '' : 's'} lost to a ${reason} on ${register}`
}

function PipelineView({ pipeline, settings, onChange }: Props) {
	const { rows, cycles, instructions, cpi, steadyStateCpi, idealCycles, dataStalls, loadUseStalls, controlFlushes, predictions, mispredictions } = pipeline

	const lastCycle = rows.reduce((latest, row) => Math.max(latest, row.cycles[4]), pipeline.firstCycle)
	const columns: number[] = []
	for (let cycle = pipeline.firstCycle; cycle <= lastCycle; cycle++) columns.push(cycle)

	return (
		<div className="tool tool-fills">
			<div className="tool-settings">
				<label>
					Data hazards
					<select
						value={settings.dataHazards}
						onChange={(event) => onChange({ ...settings, dataHazards: event.target.value as DataHazardPolicy })}
					>
						<option value="forwarding">Forwarding (0 stalls)</option>
						<option value="split-decode">Decode with write-back (2)</option>
						<option value="none">No countermeasure (3)</option>
					</select>
				</label>
				<label>
					Branch resolved in
					<select
						value={settings.resolveBranchIn}
						onChange={(event) => onChange({ ...settings, resolveBranchIn: event.target.value as BranchResolution })}
					>
						<option value="id">ID (1 bubble)</option>
						<option value="ex">EX (2 bubbles)</option>
						<option value="mem">MEM (3 bubbles)</option>
					</select>
				</label>
				<label>
					Jump resolved in
					<select
						value={settings.resolveJumpIn}
						onChange={(event) => onChange({ ...settings, resolveJumpIn: event.target.value as JumpResolution })}
					>
						<option value="id">ID (1 bubble)</option>
						<option value="ex">EX (2 bubbles)</option>
					</select>
				</label>
				<label>
					Prediction
					<select
						value={settings.prediction}
						onChange={(event) => onChange({ ...settings, prediction: event.target.value as PredictionScheme })}
					>
						<option value="none">None</option>
						<option value="not-taken">Static, not taken</option>
						<option value="taken">Static, taken</option>
						<option value="one-bit">Dynamic, 1-bit</option>
						<option value="two-bit">Dynamic, 2-bit</option>
					</select>
				</label>
				<label>
					Rows
					<select value={settings.windowSize} onChange={(event) => onChange({ ...settings, windowSize: Number(event.target.value) })}>
						{WINDOW_SIZES.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</label>
			</div>

			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{instructions === 0 ? '-' : cpi.toFixed(2)}</span>
					<span className="tool-metric-label">Cycles per instruction</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{instructions === 0 ? '-' : steadyStateCpi.toFixed(2)}</span>
					<span className="tool-metric-label">Steady-state CPI</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{cycles.toLocaleString()}</span>
					<span className="tool-metric-label">Cycles</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{(cycles - idealCycles).toLocaleString()}</span>
					<span className="tool-metric-label">Lost to hazards</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{dataStalls.toLocaleString()}</span>
					<span className="tool-metric-label">Data stalls</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{loadUseStalls.toLocaleString()}</span>
					<span className="tool-metric-label">Load-use</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{controlFlushes.toLocaleString()}</span>
					<span className="tool-metric-label">Branch flushes</span>
				</div>
				{predictions > 0 && (
					<div className="tool-metric">
						<span className="tool-metric-value">{((1 - mispredictions / predictions) * 100).toFixed(0)}%</span>
						<span className="tool-metric-label">Predicted right</span>
					</div>
				)}
			</div>

			<PanelGroup title="Timeline" flush className="tool-group-fills">
				{rows.length === 0 ? (
					<div className="tool-empty">Run or step a program to see it flow through the pipeline.</div>
				) : (
					<div className="pipeline-scroll">
						<table className="pipeline-grid">
							<thead>
								<tr>
									<th className="pipeline-label">Instruction</th>
									{columns.map((cycle) => <th key={cycle} className="pipeline-cycle">{cycle}</th>)}
								</tr>
							</thead>
							<tbody>
								{rows.map((row) => (
									<tr key={row.index} className={row.stalls > 0 ? 'pipeline-row-stalled' : undefined}>
										<th className="pipeline-label" title={[formatWord(row.address), describeStall(row), describePrediction(row)].filter(Boolean).join('\n')}>
											{row.op.toLowerCase()}
											{row.mispredicted && <span className="pipeline-mispredict" title="Mispredicted"> ✗</span>}
										</th>
										{columns.map((cycle) => {
											const cell = cellFor(row, cycle)
											return (
												<td key={cycle} className={cell ? `pipeline-stage pipeline-${cell.kind}` : 'pipeline-stage'}>
													{cell?.label ?? ''}
												</td>
											)
										})}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</PanelGroup>
		</div>
	)
}

export default PipelineView

import type { CacheSettings, CacheSnapshot, ReplacementPolicy } from '../tools/cache'
import './ToolPanels.css'

interface Props {
	cache: CacheSnapshot
	settings: CacheSettings
	onChange: (settings: CacheSettings) => void
}

const BLOCK_COUNTS = [1, 2, 4, 8, 16, 32, 64]
const BLOCK_SIZES = [4, 8, 16, 32, 64]
const POLICIES: ReplacementPolicy[] = ['lru', 'fifo', 'random']

function CacheSimulatorView({ cache, settings, onChange }: Props) {
	// Full associativity means one set, so the choices depend on the block count.
	const associativities = BLOCK_COUNTS.filter((value) => value <= settings.blockCount)

	return (
		<div className="tool">
			<div className="tool-settings">
				<label>
					Blocks
					<select value={settings.blockCount} onChange={(event) => onChange({ ...settings, blockCount: Number(event.target.value) })}>
						{BLOCK_COUNTS.map((value) => <option key={value} value={value}>{value}</option>)}
					</select>
				</label>
				<label>
					Block size
					<select value={settings.blockSizeBytes} onChange={(event) => onChange({ ...settings, blockSizeBytes: Number(event.target.value) })}>
						{BLOCK_SIZES.map((value) => <option key={value} value={value}>{value} B</option>)}
					</select>
				</label>
				<label>
					Associativity
					<select value={settings.associativity} onChange={(event) => onChange({ ...settings, associativity: Number(event.target.value) })}>
						{associativities.map((value) => (
							<option key={value} value={value}>
								{value === 1 ? 'direct' : value === settings.blockCount ? `full (${value})` : `${value}-way`}
							</option>
						))}
					</select>
				</label>
				<label>
					Replacement
					<select value={settings.replacement} onChange={(event) => onChange({ ...settings, replacement: event.target.value as ReplacementPolicy })}>
						{POLICIES.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
					</select>
				</label>
			</div>

			<div className="tool-headline">
				<div className="tool-metric">
					<span className="tool-metric-value">{(cache.hitRate * 100).toFixed(1)}%</span>
					<span className="tool-metric-label">Hit rate</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{cache.accesses.toLocaleString()}</span>
					<span className="tool-metric-label">Accesses</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{cache.hits.toLocaleString()}</span>
					<span className="tool-metric-label">Hits</span>
				</div>
				<div className="tool-metric">
					<span className="tool-metric-value">{cache.misses.toLocaleString()}</span>
					<span className="tool-metric-label">Misses</span>
				</div>
			</div>

			<div className="tool-bar-row">
				<span>Hit rate</span>
				<div className="tool-bar-track">
					<div className="tool-bar-fill" style={{ width: `${cache.hitRate * 100}%` }} />
				</div>
				<span className="tool-bar-value">{cache.hits}/{cache.accesses}</span>
			</div>

			<div>
				<div className="tool-metric-label">Blocks in use</div>
				<div className="tool-blocks">
					{cache.blocks.map((block, index) => (
						<div
							key={index}
							className={`tool-block${block.valid ? ' filled' : ''}`}
							title={block.valid ? `block ${index}, tag 0x${block.tag.toString(16)}` : `block ${index}, empty`}
						/>
					))}
				</div>
			</div>

			{cache.accesses === 0 && <div className="tool-empty">Run a program that touches memory.</div>}
		</div>
	)
}

export default CacheSimulatorView

import './ToolPanels.css'
import './IntroToToolsView.css'

/**
 * Static panel describing THRAX's tools - the port of idea,
 * not its text, which describes the original's own tool set and how to write a
 * MarsTool; this describes THRAX's, since neither of those things carries over.
 */

interface ToolBlurb {
	name: string
	observes: string
	shows: string
	/** Present only for a tool this panel is announcing rather than one already live. */
	status?: string
}

const REGISTERED: ToolBlurb[] = [
	{
		name: 'Instruction Statistics',
		observes: 'Every executed instruction.',
		shows: 'How many ran in each category (ALU, jump, branch, memory, coprocessor, other) and the count for each mnemonic, most frequent first.',
	},
	{
		name: 'Execution Profile',
		observes: 'Every executed instruction, and how each conditional branch resolved.',
		shows: 'A heat map by address - the same counts colour the source editor\'s gutter, on a logarithmic scale so a hot inner loop stands out from the setup around it.',
	},
	{
		name: 'Cache Simulator',
		observes: 'Data reads and writes (instruction fetches are not cached).',
		shows: 'Hit rate and which blocks currently hold data, for a configurable block count, block size, associativity, and replacement policy.',
	},
	{
		name: 'Branch History Table',
		observes: 'Every conditional branch and which way it went.',
		shows: 'Each table entry\'s saturating counter, its current prediction, and the accuracy so far, for a configurable table size and counter width.',
	},
	{
		name: 'Pipeline Model',
		observes: 'The sequence of instructions that already ran (an overlay, not a live hardware model - THRAX\'s simulator retires one instruction at a time).',
		shows: 'Where each instruction would sit in a classic five-stage pipeline, and the stall or misprediction cost of the hazards between them, under a configurable forwarding and branch-prediction policy.',
	},
	{
		name: 'Memory Reference Visualization',
		observes: 'Every data read and write, by address.',
		shows: 'A colour-coded grid, one cell per address range, so the most-touched region of memory stands out.',
	},
	{
		name: 'Mars Bot',
		observes: 'Writes to five memory-mapped registers at 0xffff8010-0xffff8050 (heading, trail on/off, move on/off), plus every executed instruction as its movement clock.',
		shows: 'The bot\'s current heading and position, and the trail it has left behind.',
	},
	{
		name: 'Scavenger Hunt',
		observes: 'Writes to the game\'s memory-mapped registers: the player switch, move requests, and task-complete flags.',
		shows: 'Each player\'s position, energy and score, the locations still to visit, and the writes that broke the rules.',
	},
	{
		name: 'Screen Magnifier',
		observes: 'Nothing in the machine; it is a lens over the workspace itself.',
		shows: 'A scaled still of the region under the pointer when the capture was taken, at a scale you choose.',
	},
	{
		name: 'Introduction to Tools',
		observes: 'Nothing.',
		shows: 'This page.',
	},
]

function ToolRow({ tool }: { tool: ToolBlurb }) {
	return (
		<div className="intro-tool">
			<div className="intro-tool-name">
				{tool.name}
				{tool.status && <span className="intro-tool-status">{tool.status}</span>}
			</div>
			<div className="intro-tool-field"><span className="intro-tool-label">Observes</span>{tool.observes}</div>
			<div className="intro-tool-field"><span className="intro-tool-label">Shows</span>{tool.shows}</div>
		</div>
	)
}

function IntroToToolsView() {
	return (
		<div className="tool intro-to-tools">
			<p>
				A THRAX tool watches a run through the simulator&rsquo;s observer seam - instruction, memory access, branch,
				reset and machine configuration - without changing what any instruction means. Attaching costs nothing
				until a tool is actually opened, so every tool below can watch every run.
			</p>

			{REGISTERED.map((tool) => <ToolRow key={tool.name} tool={tool} />)}


			<p className="intro-to-tools-footnote">
				Adding a tool means one entry in <code>tools/registry.ts</code>: its settings (if it has any), a reset,
				an attachment, and a snapshot for the panel to read. See <code>CONTEXT.md</code>&rsquo;s &ldquo;Tool&rdquo; and
				&ldquo;ToolRegistry&rdquo; entries.
			</p>
		</div>
	)
}

export default IntroToToolsView

# Thrax

A MIPS assembly IDE: an assembler and machine simulator in TypeScript with a dockable
React UI for editing, running, debugging, and visualizing programs.

## Language

### Assembly

**Diagnostic**:
A positioned assembly error or warning (severity, message, file, line, column). The only
channel by which assembly failures reach the UI.
_Avoid_: console error string, exception message

**SourceIndex**:
The bidirectional line ↔ address ↔ word relation for an assembled program, built once by
the assembler's layout pass and carried on the program.
_Avoid_: sourceMap, sourceMaps, codeWords

**Pseudo-instruction**:
A source mnemonic the assembler expands into several machine words on one source line.

### Machine

**Machine state**:
Registers, memory, PC, hi/lo, and run status, owned by the simulator and reached only
through its methods and getState(). Nothing outside the simulator writes it directly.

**Observer seam**:
The ExecutionObserver interface through which tools watch a run (instruction, memory,
branch, reset, machine configuration). The zero-cost-when-empty attachment point.
_Avoid_: listener, hook, callback list

**Tool**:
A simulation-analysis accumulator attached at the observer seam: pipeline, cache, branch
history, instruction statistics, execution profile.
_Avoid_: plugin, panel (a panel is the UI view of a tool)

**ToolRegistry**:
The one description of every tool: its settings (key, defaults, validator), reset,
attachment, and snapshot. Adding a tool means adding one entry.

### Debugging

**DebugSession**:
The module owning stepping policy and breakpoint bookkeeping, between the workspace and
the machine. The workspace never mutates machine state directly.

**Visible address**:
An address the debugger will stop at. Source-line addresses are always visible; a
pseudo-instruction's expanded words become visible only when disassembly rows are shown.

**Hidden word**:
An expanded word of a pseudo-instruction that is not currently visible; stepping passes
through it without stopping.

### X-ray

**X-ray**:
The animated CPU datapath diagram showing how the current instruction flows through
blocks and wires.

**Shape**:
The single outline definition of an x-ray block (ALU, gates, register file), from which
wire hit-testing, the on-screen SVG, and the export script all derive.
_Avoid_: outline copy, path string (those are its two derived readers)

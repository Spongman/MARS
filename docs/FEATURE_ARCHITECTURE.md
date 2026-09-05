# THRAX Web Feature Architecture

The original desktop application is a broad educational environment, not
only an assembler. The web port will add its capabilities through stable
boundaries rather than embedding simulator state in React components.

## Layered design

1. **Assembly (`src/core`)** — lexical analysis, preprocessing, directives,
   macros, symbol resolution, source maps, diagnostics, and machine-code
   export. The assembler returns an immutable `MipsProgram` that is useful to
   the debugger and all export formats.
2. **Runtime (`src/core`)** — sparse configurable memory, registers,
   coprocessors, instruction execution, and syscall dispatch. Browser-only
   services are adapters; they do not live in instruction execution.
3. **Debug session (`src/debug`)** — owns a compiled runtime instance,
   breakpoints, snapshots, execution history, call frames, and run controls.
   It exposes immutable view models to the store.
4. **Workspace (`src/components`, `src/store`)** — editor tabs, project files,
   diagnostics, registers, memory windows, console/input, persistence, and
   keyboard shortcuts. It never mutates runtime state directly.
5. **Tools (`src/tools`)** — opt-in observers for cache/pipeline, branch
   history, instruction statistics, bitmap and digital I/O. Tools subscribe to
   execution events so they do not change instruction semantics.

## Delivery order

| Phase | Desktop capabilities | Web deliverable |
| --- | --- | --- |
| 1 | Assembler and interactive debugger | Source map, diagnostics, debug session, breakpoints, forward/back stepping, memory windows |
| 2 | Core system services and processor views | Input/output, heap, files/browser storage, CP0/FP register models, display formats |
| 3 | IDE and command-line workflows | Files/tabs, find/replace, local persistence, project assembly, machine-code export |
| 4 | ISA compatibility | Remaining pseudo-ops, addressing modes, delayed branching, floating point, optional self-modifying code |
| 5 | Educational tools | Event-driven cache, pipeline, branch, bitmap, keyboard/display, statistics, visualizations |

## Compatibility boundary

Browser security prevents a direct port of desktop file dialogs, arbitrary
file I/O, MIDI, and Swing tools. Those features will use explicit browser
adapters (File System Access API, downloads, Web Audio, Canvas) and retain the
same MIPS-visible syscall semantics where practical.

## Current slice

The debugger foundation starts by making execution snapshots first-class. A
snapshot captures registers, sparse memory, PC, HI/LO, console output, and the
instruction count before each instruction. This makes backstepping reliable
and provides the event/history data required by later tools.

# Review of the unpushed working tree

> **Status: all findings addressed except 8, which is intentional and is now recorded in
> `PLAN.md` under "Not doing".** Each fix is described below its finding. Suite after the
> fixes: 1565 passed, 1 skipped; typecheck, lint and build clean.

Reviewed against `origin/main` on 2026-09-01. Nothing is committed ahead of origin; the whole
diff is in the working tree: 55 tracked files (+2547 / -1221) plus the new files.

Eight finders swept the diff from different angles (line-by-line, removed-behaviour audit,
cross-file tracing, efficiency, simplification, reuse, altitude, conventions). Every finding
below was then checked against the current tree, by running or by reading the code, before it
was kept. Findings are ranked most severe first.

## Fixed during the review

- **`src/core/__tests__/ops.test.ts:15` did not typecheck.** `replaceAll` needs `lib: es2021`
  and the project targets ES2020. It slipped through because vitest transpiles with esbuild
  and does not type-check; `tsc` was not run after the file was written. Replaced with
  `replace(/\./g, '_')`. `npm run typecheck` is clean again.

## Correctness

### 1. Bogus op `F = 139` generated from a non-mnemonic
`src/core/ops.ts:155`, `:299`

`Op.F` and `OP_NAMES[139] = 'f'` name no instruction. The generator regex that read the ISA
table matched `['f', 's', 't']` in a `for` loop in `isa.ts`. `ops.test.ts` only asserts that
every ISA mnemonic has an op, not that every op is an ISA mnemonic, so the phantom passed.

*Failure:* 140 ops for 139 mnemonics; `opFor('f')` returns 139; the guard meant to pin the
table to the ISA cannot see it.

*Fix:* drop the entry; make the test assert `OP_NAMES` equals the ISA's distinct mnemonics
exactly, in order.

**Fixed.** Entry removed; `ops.test.ts` now asserts `OP_NAMES` equals the ISA's distinct
mnemonics in both directions. Verified by putting the phantom back: the test fails.

### 2. A flash never clears if a dependency changes mid-fade
`src/components/highlight.ts:66-78` (`useFlash`), `:122-132` (`useChangedEntries`)

Both effects cancel the fade timer in their cleanup, and on the re-run both early-return
(`previous.current === token`, or `moved.size === 0`) without rescheduling it.

*Failure:* step (memory words flash), then scroll the memory panel within the fade window.
`signature` changes, cleanup clears the timer, the re-run finds nothing moved and returns;
`changed` keeps the old set indefinitely and those cells re-flash every time they scroll back
into the row pool. Same in `useFlash`: change the fade duration in Settings while a register
is lit and it stays lit forever.

*Fix:* on the early-return paths, either leave the timer alone (do not return a cleanup that
cancels it) or reschedule the clear.

**Fixed.** A `useFading` helper owns the timer, cleared only when a new flash starts or on
unmount, so a dependency change cannot cancel a fade in flight.

### 3. Signed register bits compared to unsigned addresses
`src/components/RegisterView.tsx:220`, `src/components/HistoryView.tsx:71`

`entry.bits === pointed` compares a signed int32 register value against the unsigned address
the memory view publishes; `isAddress` normalises with `>>> 0` but the equality does not.
`effect.wordAddress << 2` goes negative for byte addresses at or above `0x80000000`.
A pre-existing cousin: `simulator.ts:666` computes `nextPc = (pc + 4) | 0`, so `pc` is
negative for every instruction after the first in a `.ktext` handler, and history rows for
those instructions find no source line and cannot be hovered or clicked.

*Failure:* `$t0 = 0xffff000c`: hovering that word in Memory never lights `$t0`
(`-65524 !== 4294901772`); clicking a `[0xFFFF000C]` history chip calls
`focusMemoryAddress(-65524)`, `sectionForAddress` finds nothing, nothing is revealed. Every
user-space address works, so the feature looks fine until kernel or MMIO is involved.

*Fix:* `>>> 0` at the publish sites (`entry.bits`, `wordAddress << 2`, `nextPc`).

**Fixed** at all three. `kernelAddresses.test.ts` covers the `nextPc` case; it fails without
the fix (`expected -2147483256 to be 2147484036`). Confirmed first by running a `.ktext`
handler and printing the recorded addresses.

### 4. A detached tool's snapshot freezes but is still shown
`src/tools/registry.ts:156` (`disconnect`), `src/components/SourcePane.tsx:627-664`

`disconnect` splices the observer out but neither resets the tool nor bumps `version`, so
`views()` keeps returning the last snapshot. The gutter hover reads `pipeline.byAddress` and
`branchHistory.entries` unconditionally; only `profile` was given the `counting` guard.

*Failure:* open Pipeline, run half a program, close the tab, keep stepping. The hover shows
"Executed N times" advancing beside "Pipeline: X stall cycles" frozen at the moment the tab
closed, and stepping back does not roll X back because the detached tool never sees `onSeek`.

*Fix:* reset on disconnect (or bump `version` and have the view read as empty), and gate the
pipeline and BHT hover sections on their tools being attached.

**Fixed.** `disconnect` resets the tool and bumps `version`, so a detached tool reads as
empty; the BHT and pipeline hover sections already omit themselves when empty, so they now
disappear rather than freeze.

### 5. Heat map switched on after a run says "Never executed" everywhere
`src/store/thraxStore.ts:473-476`, `src/components/SourcePane.tsx:646-648`

`profile` attaches only while the heat-map toggle is on, and is reset on connect. Toggling the
heat map on after a run therefore yields an empty profile while `counting` is true.

*Failure:* run mandelbrot to completion, click the heat-map toggle: no line number is coloured
and every hover claims the line never ran. The user must reset and re-run, and nothing says so.

*Fix:* distinguish "not counted" from "counted zero": say nothing (or "not measured") when the
profile has seen no instructions at all, and consider a hint that the heat map counts from
when it was switched on.

**Fixed.** `counting` is now `(showHeatMap || showHeatLines) && profile.total > 0`, so an
unmeasured program says nothing about counts instead of claiming every line never ran.

### 6. Memory hover lights nothing in the editor when the address column is off
`src/components/SourcePane.tsx:727`

The whole-line `memory-hover-line` decoration was removed; `address-hovered` now lives only
on the injected address runs, which are empty when `showAddresses` is false. The default
gutter has the address column off.

*Failure:* fresh workspace, hover a word in the Memory window: previously the source line lit;
now nothing in the editor changes until the address column is enabled.

Possibly intended (the whole-line highlight was asked to go), but there is no cue. *Fix
options:* light the line number, or the whole gutter run, when the address column is off.

**Fixed.** The hovered line's *number* now lights, which shows whether or not the address
column is on. Verified in a browser: with the column off, one line number lights; with it on,
all three address runs light as well.

### 7. `setWanted` runs before `attach`, connecting to the old simulator
`src/store/thraxStore.ts:516-517`

`tools.setWanted(wantedTools())` precedes `tools.attach(nextSimulator, ...)`, so `connect`
pushes newly wanted observers onto the previous simulator's `observers` and calls
`onConfigure` with the previous device port before `attach` redoes it against the new one.

*Failure:* harmless while the old simulator is idle; if an old run loop is still stepping
during re-assembly the tool receives `onInstruction` from both machines until it ends.

*Fix:* swap the two lines, or have `attach` take the wanted set.

**Fixed.** `attach` runs first, then `setWanted`.

### 8. Device tools attach only while their panel is open — INTENTIONAL, not changed
`src/store/thraxStore.ts:471`, `src/tools/registry.ts:121-131`

`digitalLab`, `marsBot` and `scavengerHunt` observe only when their tab is open. The Digital
Lab timer interrupt is raised through `this.port`, set on connect. `LAYOUT_VERSION` 3 drops
every tool tab by default.

*Failure:* a program that enables the Digital Lab timer interrupt and spins for the handler
hangs with the tab closed, where it previously ran.

Confirmed intentional. Recorded in `PLAN.md` under "Not doing" so it is not re-raised: a tool
watches a run only while something consumes it, and a device tool therefore cannot answer a
program that never opened it.

### 9. `step={0.5}` from `min={0.2}` makes the default 2.5s invalid
`src/components/SettingsDialog.tsx:272-274`

HTML steps from `min`, so the valid values are 0.2, 0.7, 1.2, ... The default
`highlightSeconds` of 2.5, and every whole second, are off-grid.

*Failure:* the fade field is `:invalid` at its default; the spinner steps to 2.2 / 2.7; typing
3 shows the browser's "nearest valid values are 2.7 and 3.2" bubble.

*Fix:* `step={0.1}`.

**Fixed.**

### 10. "Unsupported instruction" now prints an op number
`src/core/simulator.ts:1846`

The default-case error interpolates `op`, now the integer code.

*Failure:* a word nothing handles reports `Unsupported instruction: 139` instead of a name.

*Fix:* `OP_NAMES[op]`.

**Fixed:** `OP_NAMES[op] ?? op`.

## Efficiency

### 11. A store publish on every mouse move over the editor
`src/components/SourcePane.tsx:372`, `src/store/thraxStore.ts:1086`

`onMouseMove` calls `setHoveredAddressRef.current(address ?? null)` unconditionally, and
`setHoveredAddress` is a bare `set`, so zustand notifies every listener per pointer event.
`hoverRegister` two lines earlier has the guard this path lacks. Flagged independently by five
of the eight finders; `PLAN.md` already lists it as a known gap.

*Failure:* moving the pointer across source text publishes `{ hoveredAddress: null }` 60-120
times a second, re-rendering the ~16 components that call `useTHRAXStore()` without a
selector, including HistoryView, which re-materialises every visible chip.

*Fix:* guard once in the store setters (`if (get().hoveredAddress !== address)`), so every
caller benefits, and delete the per-view guards.

**Fixed** in the store setters; the per-view guard in `SourcePane` and its ref are gone. A
store test pins that a repeat write publishes nothing.

### 12. Whole-file gutter decorations rebuilt on each hover change
`src/components/SourcePane.tsx:772`

`hoveredAddress` is a dependency of the effect that rebuilds 3-5 injected-text decorations for
every line, to add `address-hovered` to one line's class. The zone-row effect beside it
already toggles the class in place instead.

*Failure:* on a 1000-line file each hover transition allocates ~4000 decoration objects and
runs a full `deltaDecorations` diff; sweeping down the Memory panel does this per word.

*Fix:* take `hoveredAddress` out of that effect and light the line through a separate
single-line decoration, or toggle the class on the rendered span as the zone rows do.

**Fixed differently.** A whole-line `className` renders as a separate overlay div, so CSS
cannot reach the injected text from it, and a background band is the whole-line highlight that
was removed on purpose. Instead the effect now depends on the hovered *line*, so every address
not on a line of this file leaves the gutter alone.

### 13. Switch bodies still read `Op.MADDU`, `Op.CLO`, ... as properties
`src/core/simulator.ts:1604-1831`

The case labels were rebound to module consts, but seven comparisons inside case bodies
(`Op.MADDU`, `Op.MSUBU`, `Op.MSUB`, `Op.CLO`, `Op.LWL`, `Op.SWL`, `Op.BGEZAL`, `Op.BC1T`,
`Op.MOVT`) still read the 140-field class the header comment says is in dictionary mode.

*Fix:* bind them alongside the case labels.

**Fixed.** All twelve now read the bound constants; the only `Op.` left is the one in the
comment that explains why.

### 14. `recordMemory` allocates a slot on every memory write
`src/core/simulator.ts:1122`, `:869`

`slotAt` allocates an `EffectSlot` and does a `values.get` lookup before the `kind` check, so
every store instruction while recording pays for a full read even when the previous effect is
not a memory effect. `applyEffect` adds a second allocation per effect during rewind.

*Trade-off, not a bug:* `slotAt` was asked for and replaced three lookups with one. *Fix if
it shows in a profile:* check `kindAt(last) === KIND_MEMORY` first and only then take the
slot, or give the store a reusable scratch slot.

**Fixed.** `recordMemory` checks the kind first and reads the other columns only on the
memory path. `bAt` had no callers left and is deleted; `aAt` and `valueAt` are used again here.

## Simplification and reuse

### 15. Dead 16-name `KIND_*` destructure left behind
`src/core/effectKind.ts:58`

The `const { REGISTER: KIND_REGISTER, ... } = Kind` line exists three times (effectKind.ts,
effectStore.ts, simulator.ts) and the effectKind.ts copy is referenced by nothing.
`no-unused-vars` is off, so lint cannot see it.

*Fix:* export the bindings once from effectKind.ts and import them in the other two.

**Fixed.** `effectKind.ts` exports `KIND_*` and the other two import them. `HistoryView` was
still switching on `Kind.*` properties and now uses the same constants.

### 16. `aAt` / `bAt` / `valueAt` have no callers
`src/core/effectStore.ts:170-181`

Every reader moved to `slotAt`; `kindAt` is the only single-column accessor still used.

*Fix:* delete them.

**Partly.** `bAt` deleted; `aAt` and `valueAt` are used by `recordMemory` again after 14.

### 17. Call-stack address computed twice, through two channels
`src/components/DockLayout.tsx:113`, `:134-138`

`selectFrame` computes `frame === -1 ? pc : callStack[frame]?.returnAddress` and calls
`focusMemoryAddress`, yet `MemoryPanel` still passes the identical expression as the
`focusAddress` fallback, which only applies while `focusedMemory` is null.

*Fix:* `focusAddress={focusedMemory?.address ?? null}`.

**Fixed**, and `selectedFrame` dropped from `MemoryPanel`, which read it only for that
fallback.

## Conventions

### 18. Em-dash in a user-visible tooltip
`src/components/HistoryView.tsx:151`

`${chip.label} — run to here` uses U+2014. CLAUDE.md: never use em-dashes.

### 19. Comments narrate prior behaviour
`src/core/historyLog.ts:116` (`moveToEntry`), `src/core/simulator.ts:94` (`FpForm`),
`src/store/thraxStore.ts:1009` (`moveHistoryTo`), `src/components/DockLayout.tsx:261`
(`LAYOUT_VERSION`), `src/components/DockLayout.tsx:132` (`selectFrame`)

Each explains what the old code used to do. CLAUDE.md asks that comments not describe removed
behaviour or prior versions.

## Noted, not counted as findings

- **Pre-existing divergence:** `pipeline.ts` `LOADS`/`STORES` omit `lwl`/`lwr`/`swl`/`swr`/
  `ll`/`sc` and the CP1 loads and stores, while `statistics.ts` counts them as memory. Not
  introduced by this diff, but the two tools now spell the same classification twice (op sets
  in one, lowercase-name sets in the other). One classification on the ISA row would serve
  both, and `FP_FORMS` and the trap table in the simulator as well.
- **`EFFECT_KINDS` has no runtime reader.** Kept as documentation and as the anchor for
  `effectKind.test.ts`; the comment says so.
- **`wantedTools` assumes a panel id equals a tool key**, and special-cases `'profile'`. It
  holds today; a `PanelSpec.tool` field would make it a declaration instead of a coincidence.
- **The three `focus*` setters** (`focusMemoryAddress`, `focusSourceLine`, `focusRegister`)
  hand-roll the same request-counter bump. A small helper would hold the semantics once.
- **`useRowScroller`'s frame effect** depends on `scrollTop`, so each scroll event forces two
  `getBoundingClientRect` reads, and the window-level scroll listener re-measures the *other*
  scroller too. Two instances now (memory, history).
- **Three `RegisterPanel` instances** receive the same seven highlight props verbatim.
- **Five refs in `SourcePane`** mirror store fields for mount-once handlers;
  `useTHRAXStore.getState()` is already used in the same file and would do.

## Suggested order

Fix regardless: 1 (phantom op), 2 (sticky flash), 3 (sign), 11 (hover publish), 9 (step),
10 (message), 15 and 16 (dead code), 18 and 19 (conventions).

Need a decision: 4 and 5 (what a detached or late-started tool should show), 6 and 8
(behaviour changes that may be intended), 7 (ordering, one-line swap), 12 (how to light the
hovered line cheaply), 13 (bind the remaining `Op.*` reads), 14 (only if profiled), 17
(drop the fallback).

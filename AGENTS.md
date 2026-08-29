# Repository Guidelines

## Project Structure & Module Organization

THRAX is a Vite-powered React 18 web application for assembling and simulating MIPS programs. Keep application entry points in `src/main.jsx` and `src/App.jsx`. Place UI components and their paired styles in `src/components/` (for example, `Toolbar.jsx` and `Toolbar.css`). Keep MIPS language behavior in `src/core/`: `lexer.js`, `parser.js`, `assembler.js`, and `simulator.js` form the execution pipeline. Zustand state belongs in `src/store/thraxStore.js`; reusable React behavior belongs in `src/hooks/`; bundled sample programs belong in `src/examples.js`.

## Build, Test, and Development Commands

- `npm install` installs the pinned dependency tree from `package-lock.json`.
- `npm run dev` starts the Vite development server on port 3000.
- `npm run build` creates the production bundle in `dist/`.
- `npm run preview` serves the production bundle locally for a final check.
- `npm run lint` runs ESLint against `.js` and `.jsx` source files.

Run `npm run lint` and `npm run build` before opening a pull request. There is currently no automated test command; validate core changes with focused MIPS examples and UI changes in the browser.

## Coding Style & Naming Conventions

Follow the existing JavaScript style: two-space indentation, single quotes, no semicolons, and ES modules. Use PascalCase for React components and component files (`MemoryView.jsx`), camelCase for functions, hooks, variables, and modules (`useExamples.js`), and descriptive CSS classes such as `.memory-view`. Pair component-specific CSS with its component. Keep assembler and simulator logic framework-independent in `src/core/`.

## Testing Guidelines

When changing parsing, assembly, or execution semantics, add or update representative programs in `src/examples.js` and manually check registers, memory, console output, and error cases. When introducing automated tests, keep them adjacent to the module or under a new `src/**/__tests__/` directory, name them `*.test.js`, and add the test script to `package.json`.

## Commit & Pull Request Guidelines

Recent history uses short, imperative, sentence-case subjects, such as `Fix assembler branch offset calculation` and `Add step-through debugging with breakpoints`. Keep each commit focused; avoid mixing refactors with behavior changes. Pull requests should explain the user-visible and MIPS-semantic impact, link relevant issues, list validation commands, and include screenshots or a short recording for UI changes. Call out newly supported instructions, syscalls, or compatibility limitations explicitly.

## Configuration & Safety

Do not commit `node_modules/` or generated `dist/` output. Preserve the simulator's execution safeguards when modifying runtime behavior, and document any changes to memory limits or supported MIPS features in `README.md`.

# MARS - MIPS Assembler and Runtime Simulator (Web Edition)

A modern web-based port of the classic MARS MIPS simulator, built with React and Monaco Editor.

## Features

- **Monaco Editor**: Professional code editor with MIPS syntax highlighting
- **Register View**: Real-time display of all MIPS registers
- **Memory Viewer**: Inspect memory contents during execution
- **Console Output**: Capture program output and debug information
- **Modern UI**: VS Code-inspired dark theme

## Tech Stack

- **Frontend Framework**: React 18
- **Build Tool**: Vite
- **Code Editor**: Monaco Editor
- **State Management**: Zustand
- **Styling**: CSS3

## Getting Started

### Prerequisites
- Node.js 16+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Development Roadmap

- [x] UI scaffolding with React
- [x] Monaco Editor integration
- [x] Register and memory views
- [ ] MIPS assembler implementation
- [ ] MIPS runtime simulator
- [ ] Instruction execution engine
- [ ] Breakpoint support
- [ ] Step-through debugging
- [ ] Symbol table and label support
- [ ] Syscall implementation
- [ ] File I/O support
- [ ] Example programs library

## Architecture

The application is organized into several key modules:

- `src/components/`: React UI components (Editor, Registers, Memory, Console)
- `src/store/`: Zustand store for application state
- `src/core/`: (TODO) MIPS assembler and execution engine

## Contributing

This is a port of the original MARS simulator created by Pete Sanderson and Ken Vollmar.

## License

MIT License (same as original MARS)

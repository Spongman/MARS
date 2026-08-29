# THRAX - Teaching Harness for Runtime Assembly eXecution

A son of MARS (but in a different language). A modern, interactive web-based port of the classic MARS MIPS simulator, built with React, Monaco Editor, and a complete MIPS execution engine implemented in TypeScript.

![THRAX](https://img.shields.io/badge/THRAX-Web%20Edition-blue)
![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178C6)
![React](https://img.shields.io/badge/Framework-React%2018-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

## 🚀 Features

### Core Functionality
- ✅ **Complete MIPS Assembler**: Lexer → Parser → Machine Code Generator
- ✅ **Full MIPS Simulator**: Execute MIPS instructions with accurate register/memory state
- ✅ **Monaco Editor**: Professional syntax highlighting and code editing
- ✅ **Real-time Execution**: Assemble and run MIPS programs instantly
- ✅ **Register Viewer**: Monitor all 32 MIPS registers in real-time, with Coproc 1 and Coproc 0 tabs
- ✅ **Memory Inspector**: View memory contents during execution
- ✅ **Console I/O**: Output plus in-console input for supported syscalls
- ✅ **Data Segments**: Initialize memory with `.data`, labels, strings, and numeric values
- ✅ **Interactive Debugging**: Assemble, toggle source breakpoints, step, continue, and step back
- ✅ **Call Stack View**: Inspect active `jal` / `jalr` calls while stepping
- ✅ **Source Workspace**: Multiple source tabs and find/replace
- ✅ **Portable Export**: Download assembled text in THRAX HexText format
- ✅ **Bitmap Display**: Render word-addressed 24-bit RGB framebuffer memory
- ✅ **Keyboard/Display MMIO**: Queue keyboard input and inspect transmitter output at the standard THRAX device addresses
- ✅ **Example Programs**: 8 ready-to-run MIPS programs
- ✅ **Dark Theme UI**: VS Code-inspired interface

### Supported Instruction Types

**Arithmetic**: ADD, ADDI, ADDU, ADDIU, SUB, SUBU, MUL, MULT, MULTU, DIV, DIVU

**Logical**: AND, ANDI, OR, ORI, XOR, XORI, NOR

**Shifts**: SLL, SRL, SRA, SLLV, SRLV, SRAV

**Comparison**: SLT, SLTI, SLTU, SLTIU

**Load/Store**: LW, LH, LHU, LB, LBU, SW, SH, SB, LUI, LA

**Jump & Branch**: BEQ, BNE, BGEZ, BGTZ, BLEZ, BLTZ, BLT, BLE, BGT, BGE, J, JAL, JR, JALR

**Special**: MFHI, MFLO, MTHI, MTLO, NOP, MOVE, LI, SYSCALL

**Coprocessor 1 (floating point)**: LWC1, SWC1, LDC1, SDC1, MFC1, MTC1, ADD/SUB/MUL/DIV/ABS/NEG/SQRT/MOV (`.s` and `.d`), CVT.S.W, CVT.S.D, CVT.D.W, CVT.D.S, CVT.W.S, CVT.W.D, ROUND/TRUNC/CEIL/FLOOR.W (`.s` and `.d`), C.EQ/C.LT/C.LE (`.s` and `.d`), BC1T, BC1F, MOVT, MOVF. Comparisons and branches use condition flag 0; double-precision operands take the even register of an even/odd pair.

**Coprocessor 0 (system control)**: MFC0, MTC0, ERET. The register file exposes `$8` (vaddr), `$12` (status), `$13` (cause), and `$14` (epc), reachable by number or by the `$status`-style aliases.

**Assembler pseudos**: LA, B, BAL, BEQZ, BNEZ, BLT/BLE/BGT/BGE (and unsigned variants), NOT, NEG, NEGU, ABS, SEQ/SNE/SGT/SGE/SLE (and unsigned variants), REM, REMU, L.S, L.D, S.S, S.D, LI.S, LI.D. These are expanded to base MIPS instructions before addresses and branch offsets are assigned, so they work in debugging and HexText exports.

### Syscall Support
- `1`: Print integer
- `4`: Print string (null-terminated)
- `5`: Read integer
- `8`: Read string
- `9`: Allocate heap memory (`sbrk`)
- `10`: Exit program
- `11`: Print character
- `12`: Read character
- `17`: Exit with code
- `2`, `3`: Print float from `$f12` or double from `$f12`/`$f13`
- `6`, `7`: Read float or double into `$f0`
- `34`, `35`, `36`: Print integer as hexadecimal, binary, or unsigned decimal

### Memory-Mapped Keyboard and Display

The Keyboard and Display Simulator uses the original THRAX MMIO addresses:
`0xffff0000` receiver control, `0xffff0004` receiver data, `0xffff0008`
transmitter control, and `0xffff000c` transmitter data. Receiver and
transmitter readiness use bit 0. Reading receiver data consumes one queued
character; writing transmitter data appends its low byte to the tool display.

### Supported Data Directives
- Segments: `.data`, `.text`, `.kdata`, `.ktext`, each accepting an optional base address such as `.ktext 0x80000180`
- Storage: `.word`, `.half`, `.byte`, `.float`, `.double`, `.ascii`, `.asciiz`, `.space`, `.align`
- Symbols: `.globl`, `.global`, `.extern name, size` (which reserves `size` zeroed bytes in the data segment), `.eqv`
- Program structure: `.macro`/`.end_macro`, `.include "file.asm"`, and `.set`, which is accepted and ignored

### Operand Syntax
- Registers by name or number: `$t0` and `$8` are the same register, as are `$ra` and `$31`
- Character literals are integers: `li $t0, 'a'`, `.byte 'a', '
'`
- Label expressions add a constant to a label: `la $t0, arr+4`, `lw $t1, arr+4($s0)`, `.word arr+8`

### Multi-File Programs
Each editor tab is a file, and double-clicking a tab renames it. `.include "lib.asm"`
pulls in another open tab by name, and the toolbar's **All files** switch assembles
every open tab into one program instead of only the active one. Files share one
symbol table, so labels resolve across them; the active tab supplies the entry point,
which is the `main` label when the program defines one.

## 📦 Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Code Editor**: Monaco Editor
- **State Management**: Zustand
- **Styling**: CSS3
- **Build Tool**: Vite

## 🛠️ Installation & Setup

### Prerequisites
- Node.js 16+
- npm or yarn

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Spongman/THRAX.git
cd THRAX

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:3000
```

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

## 📝 Example Programs

### Sum of Numbers
```mips
# Compute 5 + 3
addi $t0, $zero, 5
addi $t1, $zero, 3
add $t2, $t0, $t1
move $a0, $t2
addi $v0, $zero, 1
syscall
addi $v0, $zero, 10
syscall
```

### Loop Counter
```mips
# Print 1 through 5
addi $t0, $zero, 1

loop:
  addi $t1, $zero, 6
  beq $t0, $t1, done
  
  move $a0, $t0
  addi $v0, $zero, 1
  syscall
  
  addi $t0, $t0, 1
  j loop

done:
  addi $v0, $zero, 10
  syscall
```

## 🏗️ Architecture

```
src/
├── core/
│   ├── lexer.ts           # Tokenization
│   ├── parser.ts          # AST generation
│   ├── assembler.ts       # Machine code generation
│   ├── simulator.ts       # Execution engine
│   ├── mipsLanguage.ts    # Monaco syntax support
│   └── index.ts           # Exports
├── components/
│   ├── Toolbar.tsx        # Run/Reset/Examples
│   ├── RegisterView.tsx   # Register display
│   ├── MemoryView.tsx     # Memory inspector
│   ├── BitmapDisplay.tsx  # Memory-mapped RGB framebuffer tool
│   ├── KeyboardDisplayTool.tsx # THRAX keyboard/display MMIO tool
│   └── ConsoleOutput.tsx  # Program output
├── store/
│   └── thraxStore.ts       # Zustand state management
├── hooks/
│   └── useExamples.ts     # Example loader hook
├── App.tsx                # Main application
└── examples.ts            # Example programs
```

## 🔄 Execution Pipeline

1. **Lexical Analysis** (`Lexer`)
   - Tokenizes assembly source code
   - Recognizes instructions, registers, labels, immediates

2. **Parsing** (`Parser`)
   - Builds AST from tokens
   - Resolves labels and addresses
   - Validates syntax

3. **Assembly** (`Assembler`)
   - Encodes instructions to machine code
   - Handles R-type, I-type, J-type formats
   - Calculates branch offsets

4. **Simulation** (`MipsSimulator`)
   - Executes machine code instruction-by-instruction
   - Manages 32 registers + special registers (HI, LO, PC) and the CP0/CP1 register files
   - Simulates memory (4MB)
   - Handles syscalls

## 📚 Roadmap

### Completed ✅
- [x] Core MIPS assembler and simulator
- [x] All basic instruction types (R, I, J)
- [x] Arithmetic operations
- [x] Logical operations
- [x] Load/store operations
- [x] Branch and jump instructions
- [x] Multiply/divide with HI/LO registers
- [x] Syscall handling (print int, char, exit)
- [x] Monaco Editor integration
- [x] Register and memory viewers
- [x] Example programs
- [x] Error reporting
- [x] MIPS syntax highlighting

### In Progress 🔄
- [x] Step-through debugging and backstepping
- [x] Breakpoint support
- [x] Call stack viewer
- [x] Bitmap display tool (24-bit RGB words, configurable base address)
- [x] Keyboard/display MMIO tool (receiver/transmitter data registers)
- [x] Interactive input (syscalls 5, 8, 12)
- [x] Assembly directives and initialized data segments

### Planned 🎯
- [x] Floating-point instructions (coprocessor 1) and coprocessor 0 registers
- [x] Cache simulation (configurable blocks, associativity, and replacement)
- [x] Pipeline visualization (five-stage timeline with per-cycle stages)
- [x] Data hazard detection (RAW, with and without forwarding)
- [x] Control hazard visualization (branch and jump resolved in ID, EX, or MEM)
- [x] Branch prediction in the pipeline (static, 1-bit, and 2-bit)
- [x] Instruction statistics and branch prediction (BHT) tools
- [x] MIPS X-Ray: the animated datapath, control unit, ALU control, and register bank, drawn as themed SVG
- [x] Delayed branching, as THRAX's setting of the same name
- [ ] Assembly program templates
- [x] Save/load programs to browser storage
- [x] Export machine code to HexText
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcuts
- [ ] Mobile responsive design
- [x] Multiple source tabs (each tab assembles independently)

### Future Enhancements 🚀
- [ ] Collaborative editing
- [ ] GPU accelerated simulation
- [ ] VR visualization mode
- [ ] AI-powered assembly generation
- [ ] Formal verification of programs

## Feature Architecture

The staged architecture for bringing the original THRAX capability set to the
web port is documented in [docs/FEATURE_ARCHITECTURE.md](docs/FEATURE_ARCHITECTURE.md).

## 🐛 Known Limitations

- Coprocessor 1 covers single and double precision arithmetic, conversion, comparison, and moves; the FCSR is modelled as the eight condition flags only, so rounding mode selection and exception enables are not configurable
- Coprocessor 0 provides the vaddr/status/cause/epc registers, `mfc0`, `mtc0`, and `eret`. A `.ktext` handler at `0x80000180` receives traps; without one, a trap records its cause and EPC and stops execution
- A label expression takes one label plus a constant (`arr+4`); differences of two labels are rejected
- A text segment can be based only before it emits instructions, since pseudo-instructions expand after parsing
- Syscall support is intentionally partial; unsupported syscall numbers stop safely with an error
- Maximum 100,000 instruction execution limit (safety); execution yields between batches so runaway code does not block the page
- Sparse virtual memory supports standard THRAX data and stack addresses; the inspector shows the first 100 initialized words

## 📖 MIPS Reference

For detailed MIPS instruction set reference, see the original THRAX documentation:
- [THRAX Official Documentation](https://github.com/dpetersanderson/THRAX)
- [MIPS ISA Reference](https://en.wikipedia.org/wiki/MIPS_architecture)

## 🤝 Contributing

Contributions are welcome! Please feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - Same as the original THRAX simulator

Original THRAX developed by Pete Sanderson and Ken Vollmar.
Web port developed by Spongman.

The X-Ray wire graph in `src/tools/xray/datapaths.ts` is generated from THRAX
4.5's datapath XML by `scripts/generate-xray-datapaths.py`.  The drawings
themselves are redrawn as themed SVG rather than copied.

## 🙏 Acknowledgments

- **Original THRAX**: Pete Sanderson and Ken Vollmar
- **Monaco Editor**: Microsoft
- **React**: Meta
- **Zustand**: Poimandres

## 📞 Support

For issues, questions, or suggestions:
1. Check existing [GitHub Issues](https://github.com/Spongman/THRAX/issues)
2. Create a new issue with detailed description
3. Include example code if reporting a bug

## 🎓 Educational Use

This simulator is designed for educational purposes. It's perfect for:
- Learning MIPS assembly language
- Understanding computer architecture
- Studying processor execution models
- Debugging assembly programs
- Teaching low-level programming concepts

---

**Try it now**: [THRAX](https://github.com/Spongman/THRAX)

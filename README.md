# MARS - MIPS Assembler and Runtime Simulator (Web Edition)

A modern, interactive web-based port of the classic MARS MIPS simulator, built with React, Monaco Editor, and a complete MIPS execution engine implemented in JavaScript.

![MARS Web Edition](https://img.shields.io/badge/MARS-Web%20Edition-blue)
![JavaScript](https://img.shields.io/badge/Language-JavaScript-yellow)
![React](https://img.shields.io/badge/Framework-React%2018-61dafb)
![License](https://img.shields.io/badge/License-MIT-green)

## 🚀 Features

### Core Functionality
- ✅ **Complete MIPS Assembler**: Lexer → Parser → Machine Code Generator
- ✅ **Full MIPS Simulator**: Execute MIPS instructions with accurate register/memory state
- ✅ **Monaco Editor**: Professional syntax highlighting and code editing
- ✅ **Real-time Execution**: Assemble and run MIPS programs instantly
- ✅ **Register Viewer**: Monitor all 32 MIPS registers in real-time
- ✅ **Memory Inspector**: View memory contents during execution
- ✅ **Console Output**: Capture syscall output (print int, char, exit)
- ✅ **Example Programs**: 5 ready-to-run MIPS programs
- ✅ **Dark Theme UI**: VS Code-inspired interface

### Supported Instruction Types

**Arithmetic**: ADD, ADDI, ADDU, ADDIU, SUB, SUBU, MUL, MULT, MULTU, DIV, DIVU

**Logical**: AND, ANDI, OR, ORI, XOR, XORI, NOR

**Shifts**: SLL, SRL, SRA, SLLV, SRLV, SRAV

**Comparison**: SLT, SLTI, SLTU, SLTIU

**Load/Store**: LW, LH, LHU, LB, LBU, SW, SH, SB, LUI, LA

**Jump & Branch**: BEQ, BNE, BGEZ, BGTZ, BLEZ, BLTZ, J, JAL, JR, JALR

**Special**: MFHI, MFLO, MTHI, MTLO, NOP, MOVE, LI, SYSCALL

### Syscall Support
- `1`: Print integer
- `4`: Print string (null-terminated)
- `10`: Exit program
- `11`: Print character

## 📦 Tech Stack

- **Frontend**: React 18 + Vite
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
git clone https://github.com/Spongman/MARS.git
cd MARS

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
│   ├── lexer.js           # Tokenization
│   ├── parser.js          # AST generation
│   ├── assembler.js       # Machine code generation
│   ├── simulator.js       # Execution engine
│   ├── mipsLanguage.js    # Monaco syntax support
│   └── index.js           # Exports
├── components/
│   ├── Toolbar.jsx        # Run/Reset/Examples
│   ├── RegisterView.jsx   # Register display
│   ├── MemoryView.jsx     # Memory inspector
│   └── ConsoleOutput.jsx  # Program output
├── store/
│   └── marsStore.js       # Zustand state management
├── hooks/
│   └── useExamples.js     # Example loader hook
├── App.jsx                # Main application
└── examples.js            # Example programs
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
   - Manages 32 registers + special registers (HI, LO, PC)
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
- [ ] Step-through debugging
- [ ] Breakpoint support
- [ ] Call stack viewer
- [ ] Memory data visualization
- [ ] Interactive input (syscall 5, 8)
- [ ] Assembly directives (.word, .asciiz, etc.)

### Planned 🎯
- [ ] Floating-point instructions
- [ ] Cache simulation
- [ ] Pipeline visualization
- [ ] Data hazard detection
- [ ] Control hazard visualization
- [ ] Assembly program templates
- [ ] Save/load programs to browser storage
- [ ] Export machine code to hex
- [ ] Dark/light theme toggle
- [ ] Keyboard shortcuts
- [ ] Mobile responsive design
- [ ] Multi-file project support

### Future Enhancements 🚀
- [ ] Collaborative editing
- [ ] GPU accelerated simulation
- [ ] VR visualization mode
- [ ] AI-powered assembly generation
- [ ] Formal verification of programs

## 🐛 Known Limitations

- No floating-point instruction support
- No coprocessor (CP0) instructions
- Limited syscall support (basic I/O only)
- No directive support (.word, .asciiz, etc.)
- Maximum 100,000 instruction execution limit (safety)
- Memory size limited to 4MB in browser

## 📖 MIPS Reference

For detailed MIPS instruction set reference, see the original MARS documentation:
- [MARS Official Documentation](https://github.com/dpetersanderson/MARS)
- [MIPS ISA Reference](https://en.wikipedia.org/wiki/MIPS_architecture)

## 🤝 Contributing

Contributions are welcome! Please feel free to:
- Report bugs
- Suggest features
- Submit pull requests
- Improve documentation

## 📄 License

MIT License - Same as the original MARS simulator

Original MARS developed by Pete Sanderson and Ken Vollmar.
Web port developed by Spongman.

## 🙏 Acknowledgments

- **Original MARS**: Pete Sanderson and Ken Vollmar
- **Monaco Editor**: Microsoft
- **React**: Meta
- **Zustand**: Poimandres

## 📞 Support

For issues, questions, or suggestions:
1. Check existing [GitHub Issues](https://github.com/Spongman/MARS/issues)
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

**Try it now**: [MARS Web Edition](https://github.com/Spongman/MARS)

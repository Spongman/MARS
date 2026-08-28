/**
 * MIPS Runtime Simulator - Executes MIPS machine code
 */

export class MipsSimulator {
  constructor(machineCode, program) {
    this.machineCode = machineCode
    this.program = program
    this.registers = this.initializeRegisters()
    this.memory = new Uint32Array(1024 * 1024) // 4MB memory
    this.pc = 0x00400000
    this.hi = 0
    this.lo = 0
    this.console = ''
    this.running = false
    this.halted = false
    this.instructionCount = 0
    this.addressToInstructionMap = new Map()
    this.buildAddressMap()
  }

  initializeRegisters() {
    return {
      $zero: 0,
      $at: 0,
      $v0: 0,
      $v1: 0,
      $a0: 0,
      $a1: 0,
      $a2: 0,
      $a3: 0,
      $t0: 0,
      $t1: 0,
      $t2: 0,
      $t3: 0,
      $t4: 0,
      $t5: 0,
      $t6: 0,
      $t7: 0,
      $s0: 0,
      $s1: 0,
      $s2: 0,
      $s3: 0,
      $s4: 0,
      $s5: 0,
      $s6: 0,
      $s7: 0,
      $t8: 0,
      $t9: 0,
      $k0: 0,
      $k1: 0,
      $gp: 0x10008000,
      $sp: 0x7fffeffc,
      $fp: 0,
      $ra: 0,
      $pc: 0x00400000,
      $hi: 0,
      $lo: 0,
    }
  }

  buildAddressMap() {
    let addr = 0x00400000
    for (let i = 0; i < this.machineCode.length; i++) {
      this.addressToInstructionMap.set(addr, i)
      addr += 4
    }
  }

  run() {
    this.running = true
    this.console = ''

    try {
      while (this.running && !this.halted && this.instructionCount < 100000) {
        this.step()
      }
    } catch (error) {
      this.console += `\nError: ${error.message}\n`
      this.halted = true
    }

    this.running = false
  }

  step() {
    if (this.halted) return

    const instrIndex = this.addressToInstructionMap.get(this.pc)
    if (instrIndex === undefined) {
      this.halted = true
      return
    }

    const code = this.machineCode[instrIndex]
    const instr = this.program.instructions[instrIndex]

    this.executeInstruction(code, instr)
    this.pc += 4
    this.instructionCount++
  }

  executeInstruction(code, instr) {
    if (!instr) return

    const name = instr.name

    try {
      switch (name) {
        // Arithmetic
        case 'ADD':
        case 'ADDU': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], (rs + rt) | 0)
          break
        }
        case 'ADDI':
        case 'ADDIU': {
          const rs = this.getReg(instr.args[1])
          const imm = this.getImm(instr.args[2])
          this.setReg(instr.args[0], (rs + imm) | 0)
          break
        }
        case 'SUB':
        case 'SUBU': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], (rs - rt) | 0)
          break
        }

        // Logical
        case 'AND': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], rs & rt)
          break
        }
        case 'ANDI': {
          const rs = this.getReg(instr.args[1])
          const imm = this.getImm(instr.args[2])
          this.setReg(instr.args[0], rs & imm)
          break
        }
        case 'OR': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], rs | rt)
          break
        }
        case 'ORI': {
          const rs = this.getReg(instr.args[1])
          const imm = this.getImm(instr.args[2])
          this.setReg(instr.args[0], rs | imm)
          break
        }
        case 'XOR': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], rs ^ rt)
          break
        }
        case 'XORI': {
          const rs = this.getReg(instr.args[1])
          const imm = this.getImm(instr.args[2])
          this.setReg(instr.args[0], rs ^ imm)
          break
        }
        case 'NOR': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], ~(rs | rt))
          break
        }

        // Shifts
        case 'SLL': {
          const rt = this.getReg(instr.args[1])
          const shamt = this.getImm(instr.args[2])
          this.setReg(instr.args[0], (rt << shamt) | 0)
          break
        }
        case 'SRL': {
          const rt = this.getReg(instr.args[1])
          const shamt = this.getImm(instr.args[2])
          this.setReg(instr.args[0], (rt >>> shamt) | 0)
          break
        }
        case 'SRA': {
          const rt = this.getReg(instr.args[1])
          const shamt = this.getImm(instr.args[2])
          this.setReg(instr.args[0], (rt >> shamt) | 0)
          break
        }

        // Comparison
        case 'SLT': {
          const rs = this.getReg(instr.args[1])
          const rt = this.getReg(instr.args[2])
          this.setReg(instr.args[0], rs < rt ? 1 : 0)
          break
        }
        case 'SLTI': {
          const rs = this.getReg(instr.args[1])
          const imm = this.getImm(instr.args[2])
          this.setReg(instr.args[0], rs < imm ? 1 : 0)
          break
        }
        case 'SLTU': {
          const rs = (this.getReg(instr.args[1]) >>> 0)
          const rt = (this.getReg(instr.args[2]) >>> 0)
          this.setReg(instr.args[0], rs < rt ? 1 : 0)
          break
        }
        case 'SLTIU': {
          const rs = (this.getReg(instr.args[1]) >>> 0)
          const imm = (this.getImm(instr.args[2]) >>> 0)
          this.setReg(instr.args[0], rs < imm ? 1 : 0)
          break
        }

        // Multiply/Divide
        case 'MULT': {
          const rs = this.getReg(instr.args[0]) | 0
          const rt = this.getReg(instr.args[1]) | 0
          const result = rs * rt
          this.hi = Math.floor(result / 0x100000000) | 0
          this.lo = result | 0
          break
        }
        case 'MULTU': {
          const rs = (this.getReg(instr.args[0]) >>> 0)
          const rt = (this.getReg(instr.args[1]) >>> 0)
          const result = rs * rt
          this.hi = Math.floor(result / 0x100000000) >>> 0
          this.lo = result >>> 0
          break
        }
        case 'DIV': {
          const rs = this.getReg(instr.args[0]) | 0
          const rt = this.getReg(instr.args[1]) | 0
          if (rt !== 0) {
            this.lo = Math.floor(rs / rt) | 0
            this.hi = (rs % rt) | 0
          }
          break
        }
        case 'DIVU': {
          const rs = this.getReg(instr.args[0]) >>> 0
          const rt = this.getReg(instr.args[1]) >>> 0
          if (rt !== 0) {
            this.lo = Math.floor(rs / rt) >>> 0
            this.hi = (rs % rt) >>> 0
          }
          break
        }
        case 'MFHI':
          this.setReg(instr.args[0], this.hi)
          break
        case 'MFLO':
          this.setReg(instr.args[0], this.lo)
          break
        case 'MTHI':
          this.hi = this.getReg(instr.args[0]) | 0
          break
        case 'MTLO':
          this.lo = this.getReg(instr.args[0]) | 0
          break

        // Load/Store
        case 'LW': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.readMemory(addr, 4)
          this.setReg(instr.args[0], value)
          break
        }
        case 'LH': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.readMemory(addr, 2)
          this.setReg(instr.args[0], value << 16 >> 16) // Sign extend
          break
        }
        case 'LHU': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.readMemory(addr, 2)
          this.setReg(instr.args[0], value)
          break
        }
        case 'LB': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.readMemory(addr, 1)
          this.setReg(instr.args[0], value << 24 >> 24) // Sign extend
          break
        }
        case 'LBU': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.readMemory(addr, 1)
          this.setReg(instr.args[0], value)
          break
        }
        case 'SW': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.getReg(instr.args[0])
          this.writeMemory(addr, value, 4)
          break
        }
        case 'SH': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.getReg(instr.args[0])
          this.writeMemory(addr, value, 2)
          break
        }
        case 'SB': {
          const addr = this.getMemAddress(instr.args[1])
          const value = this.getReg(instr.args[0])
          this.writeMemory(addr, value, 1)
          break
        }
        case 'LUI': {
          const imm = this.getImm(instr.args[1])
          this.setReg(instr.args[0], (imm << 16) | 0)
          break
        }

        // Jump & Branch
        case 'BEQ': {
          const rs = this.getReg(instr.args[0])
          const rt = this.getReg(instr.args[1])
          if (rs === rt) {
            const offset = this.getImm(instr.args[2])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'BNE': {
          const rs = this.getReg(instr.args[0])
          const rt = this.getReg(instr.args[1])
          if (rs !== rt) {
            const offset = this.getImm(instr.args[2])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'BGEZ': {
          const rs = this.getReg(instr.args[0])
          if (rs >= 0) {
            const offset = this.getImm(instr.args[1])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'BGTZ': {
          const rs = this.getReg(instr.args[0])
          if (rs > 0) {
            const offset = this.getImm(instr.args[1])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'BLEZ': {
          const rs = this.getReg(instr.args[0])
          if (rs <= 0) {
            const offset = this.getImm(instr.args[1])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'BLTZ': {
          const rs = this.getReg(instr.args[0])
          if (rs < 0) {
            const offset = this.getImm(instr.args[1])
            this.pc = (this.pc + (offset * 4)) | 0
          }
          break
        }
        case 'J': {
          const address = this.getImm(instr.args[0])
          this.pc = ((this.pc & 0xf0000000) | (address << 2)) - 4
          break
        }
        case 'JAL': {
          this.registers['$ra'] = (this.pc + 4) | 0
          const address = this.getImm(instr.args[0])
          this.pc = ((this.pc & 0xf0000000) | (address << 2)) - 4
          break
        }
        case 'JR': {
          const addr = this.getReg(instr.args[0])
          this.pc = addr - 4
          break
        }
        case 'JALR': {
          this.registers['$ra'] = (this.pc + 4) | 0
          const addr = this.getReg(instr.args[0])
          this.pc = addr - 4
          break
        }

        // Pseudo-instructions
        case 'NOP':
          break
        case 'MOVE': {
          const rs = this.getReg(instr.args[1])
          this.setReg(instr.args[0], rs)
          break
        }
        case 'LI': {
          const imm = this.getImm(instr.args[1])
          this.setReg(instr.args[0], imm)
          break
        }
        case 'LA': {
          const addr = this.getImm(instr.args[1])
          this.setReg(instr.args[0], addr)
          break
        }

        // System
        case 'SYSCALL':
          this.handleSyscall()
          break
      }
    } catch (error) {
      throw new Error(`Error executing ${name}: ${error.message}`)
    }
  }

  handleSyscall() {
    const code = this.registers['$v0'] | 0

    switch (code) {
      case 1: // Print integer
        this.console += (this.registers['$a0'] | 0)
        break
      case 4: // Print string
        // Read string from memory at $a0
        let addr = this.registers['$a0'] >>> 0
        let str = ''
        for (let i = 0; i < 1000; i++) {
          const byte = this.readMemory(addr, 1)
          if (byte === 0) break
          str += String.fromCharCode(byte)
          addr += 1
        }
        this.console += str
        break
      case 5: // Read integer
        // TODO: Interactive input
        break
      case 8: // Read string
        // TODO: Interactive input
        break
      case 10: // Exit
        this.halted = true
        break
      case 11: // Print character
        this.console += String.fromCharCode(this.registers['$a0'] & 0xff)
        break
    }
  }

  getReg(arg) {
    if (typeof arg === 'string') {
      return this.registers[arg] || 0
    }
    if (arg.type === 'register') {
      return this.registers[arg.value] || 0
    }
    return 0
  }

  setReg(arg, value) {
    const regName = typeof arg === 'string' ? arg : arg.value
    if (regName !== '$zero') {
      this.registers[regName] = value | 0
    }
  }

  getImm(arg) {
    if (typeof arg === 'number') return arg | 0
    if (typeof arg === 'object') {
      if (arg.type === 'immediate') return arg.value | 0
      if (arg.type === 'label' && arg.address !== undefined) return arg.address
      if (arg.value !== undefined) return arg.value | 0
    }
    return 0
  }

  getMemAddress(arg) {
    if (typeof arg === 'object' && arg.type === 'memory') {
      const offset = this.getImm(arg.offset)
      const base = this.getReg(arg.register)
      return ((base + offset) >>> 0)
    }
    return 0
  }

  readMemory(addr, size) {
    const wordAddr = (addr >>> 2) >>> 0
    const word = this.memory[wordAddr] || 0
    const offset = addr % 4

    if (size === 1) {
      return (word >>> (offset * 8)) & 0xff
    }
    if (size === 2) {
      return (word >>> (offset * 8)) & 0xffff
    }
    return word
  }

  writeMemory(addr, value, size) {
    const wordAddr = (addr >>> 2) >>> 0
    let word = this.memory[wordAddr] || 0
    const offset = addr % 4

    if (size === 1) {
      const mask = 0xff << (offset * 8)
      word = (word & ~mask) | ((value & 0xff) << (offset * 8))
    } else if (size === 2) {
      const mask = 0xffff << (offset * 8)
      word = (word & ~mask) | ((value & 0xffff) << (offset * 8))
    } else {
      word = value >>> 0
    }

    this.memory[wordAddr] = word >>> 0
  }

  getState() {
    return {
      registers: { ...this.registers },
      memory: this.getMemoryView(),
      console: this.console,
      pc: this.pc,
      hi: this.hi,
      lo: this.lo,
      instructionCount: this.instructionCount,
    }
  }

  getMemoryView() {
    const view = {}
    for (let i = 0; i < Math.min(this.memory.length, 100); i++) {
      if (this.memory[i] !== 0) {
        const addr = `0x${(i * 4).toString(16).padStart(8, '0').toUpperCase()}`
        view[addr] = this.memory[i]
      }
    }
    return view
  }
}

/**
 * MIPS Assembler - Converts assembly code to machine code
 */

import { Lexer } from './lexer'
import { Parser } from './parser'

export class Assembler {
  constructor(source) {
    this.source = source
    this.program = null
    this.machineCode = []
  }

  assemble() {
    // Lexical analysis
    const lexer = new Lexer(this.source)
    const tokens = lexer.tokenize()

    // Parse
    const parser = new Parser(tokens)
    this.program = parser.parse()

    // Generate machine code
    this.generateMachineCode()

    return {
      program: this.program,
      machineCode: this.machineCode,
    }
  }

  generateMachineCode() {
    for (const instr of this.program.instructions) {
      const code = this.encodeInstruction(instr)
      this.machineCode.push(code)
    }
  }

  encodeInstruction(instr) {
    const name = instr.name

    // Resolve labels in arguments
    const args = instr.args.map((arg) => {
      if (arg.type === 'label') {
        return {
          ...arg,
          address: this.program.labels.get(arg.value),
        }
      }
      return arg
    })

    // R-type instructions (func-based)
    const rTypeInstructions = {
      ADD: { opcode: 0, func: 0x20 },
      ADDU: { opcode: 0, func: 0x21 },
      SUB: { opcode: 0, func: 0x22 },
      SUBU: { opcode: 0, func: 0x23 },
      AND: { opcode: 0, func: 0x24 },
      OR: { opcode: 0, func: 0x25 },
      XOR: { opcode: 0, func: 0x26 },
      NOR: { opcode: 0, func: 0x27 },
      SLT: { opcode: 0, func: 0x2a },
      SLTU: { opcode: 0, func: 0x2b },
      MULT: { opcode: 0, func: 0x18 },
      MULTU: { opcode: 0, func: 0x19 },
      DIV: { opcode: 0, func: 0x1a },
      DIVU: { opcode: 0, func: 0x1b },
      MFHI: { opcode: 0, func: 0x10 },
      MFLO: { opcode: 0, func: 0x12 },
      MTHI: { opcode: 0, func: 0x11 },
      MTLO: { opcode: 0, func: 0x13 },
      SLL: { opcode: 0, func: 0x00 },
      SRL: { opcode: 0, func: 0x02 },
      SRA: { opcode: 0, func: 0x03 },
      SLLV: { opcode: 0, func: 0x04 },
      SRLV: { opcode: 0, func: 0x06 },
      SRAV: { opcode: 0, func: 0x07 },
      JR: { opcode: 0, func: 0x08 },
      JALR: { opcode: 0, func: 0x09 },
    }

    // I-type instructions
    const iTypeInstructions = {
      ADDI: 0x08,
      ADDIU: 0x09,
      SLTI: 0x0a,
      SLTIU: 0x0b,
      ANDI: 0x0c,
      ORI: 0x0d,
      XORI: 0x0e,
      LUI: 0x0f,
      BEQ: 0x04,
      BNE: 0x05,
      BGEZ: 0x01,
      BGTZ: 0x07,
      BLEZ: 0x06,
      BLTZ: 0x01,
      LW: 0x23,
      LH: 0x21,
      LHU: 0x25,
      LB: 0x20,
      LBU: 0x24,
      SW: 0x2b,
      SH: 0x29,
      SB: 0x28,
    }

    // J-type instructions
    const jTypeInstructions = {
      J: 0x02,
      JAL: 0x03,
    }

    if (rTypeInstructions[name]) {
      return this.encodeRType(name, args, rTypeInstructions[name])
    }
    if (iTypeInstructions[name]) {
      return this.encodeIType(name, args, iTypeInstructions[name])
    }
    if (jTypeInstructions[name]) {
      return this.encodeJType(name, args, jTypeInstructions[name])
    }

    // Pseudo-instructions
    switch (name) {
      case 'NOP':
        return 0x00000000
      case 'MOVE':
        // move $rd, $rs -> addu $rd, $rs, $zero
        return this.encodeRType('ADDU', args, { opcode: 0, func: 0x21 })
      case 'LI':
        // li $rt, imm -> lui then ori (simplified)
        return this.encodeIType('LUI', args, 0x0f)
      case 'LA':
        // la $rt, label -> lui then ori (simplified)
        return this.encodeIType('LUI', args, 0x0f)
      case 'SYSCALL':
        return 0x0000000c
      default:
        throw new Error(`Unknown instruction: ${name}`)
    }
  }

  encodeRType(name, args, { opcode, func }) {
    let rs = 0,
      rt = 0,
      rd = 0,
      shamt = 0

    // Determine argument positions based on instruction
    if (['SLL', 'SRL', 'SRA'].includes(name)) {
      // rd, rt, shamt format
      rd = this.getRegisterNumber(args[0])
      rt = this.getRegisterNumber(args[1])
      shamt = this.getImmediateValue(args[2])
    } else if (['MFHI', 'MFLO'].includes(name)) {
      // rd only
      rd = this.getRegisterNumber(args[0])
    } else if (['MTHI', 'MTLO', 'JR'].includes(name)) {
      // rs only
      rs = this.getRegisterNumber(args[0])
    } else if (['JALR'].includes(name)) {
      // rd, rs format (or rs only)
      if (args.length === 2) {
        rd = this.getRegisterNumber(args[0])
        rs = this.getRegisterNumber(args[1])
      } else {
        rs = this.getRegisterNumber(args[0])
      }
    } else {
      // Standard rd, rs, rt format (or variants)
      rd = this.getRegisterNumber(args[0])
      rs = this.getRegisterNumber(args[1])
      rt = this.getRegisterNumber(args[2])
    }

    return (opcode << 26) | (rs << 21) | (rt << 16) | (rd << 11) | (shamt << 6) | func
  }

  encodeIType(name, args, opcode) {
    let rs = 0,
      rt = 0,
      imm = 0

    // Load/Store instructions: rt, offset(rs)
    if (['LW', 'LH', 'LHU', 'LB', 'LBU', 'SW', 'SH', 'SB'].includes(name)) {
      rt = this.getRegisterNumber(args[0])
      rs = this.getRegisterNumber(args[1].register)
      imm = this.getImmediateValue(args[1].offset) & 0xffff
    }
    // Branch instructions: rs, rt, offset
    else if (['BEQ', 'BNE'].includes(name)) {
      rs = this.getRegisterNumber(args[0])
      rt = this.getRegisterNumber(args[1])
      imm = this.getBranchOffset(args[2]) & 0xffff
    }
    // Branch with zero register: rs, offset
    else if (['BGEZ', 'BGTZ', 'BLEZ', 'BLTZ'].includes(name)) {
      rs = this.getRegisterNumber(args[0])
      imm = this.getBranchOffset(args[1]) & 0xffff
    }
    // LUI: rt, imm
    else if (name === 'LUI') {
      rt = this.getRegisterNumber(args[0])
      imm = this.getImmediateValue(args[1]) & 0xffff
    }
    // Standard: rt, rs, imm
    else {
      rt = this.getRegisterNumber(args[0])
      rs = this.getRegisterNumber(args[1])
      imm = this.getImmediateValue(args[2]) & 0xffff
    }

    return (opcode << 26) | (rs << 21) | (rt << 16) | imm
  }

  encodeJType(name, args, opcode) {
    const address = this.getJumpAddress(args[0]) >> 2
    return (opcode << 26) | (address & 0x3ffffff)
  }

  getRegisterNumber(arg) {
    const regMap = {
      $zero: 0,
      $0: 0,
      $at: 1,
      $1: 1,
      $v0: 2,
      $2: 2,
      $v1: 3,
      $3: 3,
      $a0: 4,
      $4: 4,
      $a1: 5,
      $5: 5,
      $a2: 6,
      $6: 6,
      $a3: 7,
      $7: 7,
      $t0: 8,
      $8: 8,
      $t1: 9,
      $9: 9,
      $t2: 10,
      $10: 10,
      $t3: 11,
      $11: 11,
      $t4: 12,
      $12: 12,
      $t5: 13,
      $13: 13,
      $t6: 14,
      $14: 14,
      $t7: 15,
      $15: 15,
      $s0: 16,
      $16: 16,
      $s1: 17,
      $17: 17,
      $s2: 18,
      $18: 18,
      $s3: 19,
      $19: 19,
      $s4: 20,
      $20: 20,
      $s5: 21,
      $21: 21,
      $s6: 22,
      $22: 22,
      $s7: 23,
      $23: 23,
      $t8: 24,
      $24: 24,
      $t9: 25,
      $25: 25,
      $k0: 26,
      $26: 26,
      $k1: 27,
      $27: 27,
      $gp: 28,
      $28: 28,
      $sp: 29,
      $29: 29,
      $fp: 30,
      $30: 30,
      $ra: 31,
      $31: 31,
    }

    if (typeof arg === 'object' && arg.value) {
      return regMap[arg.value] ?? 0
    }
    return regMap[arg] ?? 0
  }

  getImmediateValue(arg) {
    if (typeof arg === 'number') return arg
    if (typeof arg === 'object' && arg.type === 'immediate') return arg.value
    if (typeof arg === 'object' && arg.value !== undefined) return arg.value
    return 0
  }

  getBranchOffset(arg) {
    if (typeof arg === 'number') return arg
    if (typeof arg === 'object' && arg.address !== undefined) {
      // Offset is relative to PC+4
      return arg.address - (this.currentAddress + 4)
    }
    return 0
  }

  getJumpAddress(arg) {
    if (typeof arg === 'number') return arg
    if (typeof arg === 'object' && arg.address !== undefined) {
      return arg.address
    }
    return 0
  }
}

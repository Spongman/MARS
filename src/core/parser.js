/**
 * MIPS Parser - Converts tokens into an AST
 */

export class Instruction {
  constructor(name, args = [], labels = []) {
    this.name = name
    this.args = args
    this.labels = labels
    this.address = null
  }
}

export class Directive {
  constructor(name, args = []) {
    this.name = name
    this.args = args
    this.address = null
  }
}

export class Label {
  constructor(name, address) {
    this.name = name
    this.address = address
  }
}

export class Parser {
  constructor(tokens) {
    this.tokens = tokens
    this.pos = 0
    this.instructions = []
    this.labels = new Map()
    this.currentLabels = []
  }

  parse() {
    while (!this.isAtEnd()) {
      this.skipNewlines()
      if (this.isAtEnd()) break

      const token = this.peek()

      if (token.type === 'LABEL') {
        this.currentLabels.push(token.value)
        this.advance() // consume label
        this.consume('COLON', 'Expected ":" after label')
        this.skipNewlines()
        continue
      }

      if (token.type === 'DIRECTIVE') {
        this.parseDirective()
        continue
      }

      if (token.type === 'INSTRUCTION') {
        this.parseInstruction()
        continue
      }

      this.advance()
    }

    // Assign addresses and register labels
    let address = 0x00400000
    for (const instr of this.instructions) {
      instr.address = address
      for (const label of instr.labels) {
        this.labels.set(label, address)
      }
      address += 4
    }

    return {
      instructions: this.instructions,
      labels: this.labels,
    }
  }

  parseInstruction() {
    const name = this.consume('INSTRUCTION').value
    const args = this.parseArguments()
    const instr = new Instruction(name, args, this.currentLabels)
    this.instructions.push(instr)
    this.currentLabels = []
    this.skipNewlines()
  }

  parseDirective() {
    const name = this.consume('DIRECTIVE').value
    const args = this.parseArguments()
    // TODO: Handle directives like .word, .asciiz, etc.
    this.skipNewlines()
  }

  parseArguments() {
    const args = []

    while (!this.isAtEnd() && this.peek().type !== 'NEWLINE' && this.peek().type !== 'EOF') {
      const arg = this.parseArgument()
      if (arg) args.push(arg)

      if (this.peek().type === 'COMMA') {
        this.advance()
      }
    }

    return args
  }

  parseArgument() {
    const token = this.peek()

    if (token.type === 'DOLLAR') {
      this.advance()
      const regToken = this.consume('IDENTIFIER', 'Expected register name')
      return { type: 'register', value: '$' + regToken.value }
    }

    if (token.type === 'NUMBER') {
      const value = this.consume('NUMBER').value
      return { type: 'immediate', value: this.parseNumber(value) }
    }

    if (token.type === 'IDENTIFIER') {
      const value = this.consume('IDENTIFIER').value
      return { type: 'label', value }
    }

    if (token.type === 'LPAREN') {
      this.advance()
      const offset = this.parseArgument()
      this.consume('DOLLAR', 'Expected $ in memory operand')
      const register = this.consume('IDENTIFIER').value
      this.consume('RPAREN', 'Expected )')
      return { type: 'memory', offset, register: '$' + register }
    }

    if (token.type === 'STRING') {
      return { type: 'string', value: this.consume('STRING').value }
    }

    return null
  }

  parseNumber(str) {
    if (str.startsWith('0x') || str.startsWith('0X')) {
      return parseInt(str, 16)
    }
    return parseInt(str, 10)
  }

  skipNewlines() {
    while (this.peek().type === 'NEWLINE') {
      this.advance()
    }
  }

  peek(offset = 0) {
    const pos = this.pos + offset
    return pos < this.tokens.length ? this.tokens[pos] : this.tokens[this.tokens.length - 1]
  }

  advance() {
    if (!this.isAtEnd()) this.pos++
  }

  consume(type, message = '') {
    if (this.peek().type !== type) {
      throw new Error(
        `${message || `Expected ${type}`} at line ${this.peek().line}:${this.peek().column}`
      )
    }
    const token = this.peek()
    this.advance()
    return token
  }

  isAtEnd() {
    return this.peek().type === 'EOF'
  }
}

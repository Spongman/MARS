/**
 * MIPS Lexer - Tokenizes MIPS assembly code
 */

export class Token {
  constructor(type, value, line, column) {
    this.type = type
    this.value = value
    this.line = line
    this.column = column
  }
}

export class Lexer {
  constructor(source) {
    this.source = source
    this.pos = 0
    this.line = 1
    this.column = 1
    this.tokens = []
  }

  tokenize() {
    while (this.pos < this.source.length) {
      this.skipWhitespace()
      if (this.pos >= this.source.length) break

      // Skip comments
      if (this.peek() === '#') {
        this.skipLine()
        continue
      }

      const token = this.nextToken()
      if (token) this.tokens.push(token)
    }

    this.tokens.push(new Token('EOF', '', this.line, this.column))
    return this.tokens
  }

  nextToken() {
    const char = this.peek()

    if (!char) return null

    // Labels: identifier followed by colon
    if (this.isAlpha(char)) {
      return this.readIdentifierOrKeyword()
    }

    // Numbers
    if (this.isDigit(char)) {
      return this.readNumber()
    }

    // Strings
    if (char === '"') {
      return this.readString()
    }

    // Operators and punctuation
    const line = this.line
    const col = this.column
    this.advance()

    switch (char) {
      case ','
        return new Token('COMMA', ',', line, col)
      case '('
        return new Token('LPAREN', '(', line, col)
      case ')'
        return new Token('RPAREN', ')', line, col)
      case ':'
        return new Token('COLON', ':', line, col)
      case '$'
        return new Token('DOLLAR', '$', line, col)
      case '\n'
        return new Token('NEWLINE', '\n', line, col)
      default:
        throw new Error(`Unexpected character: ${char} at line ${line}:${col}`)
    }
  }

  readIdentifierOrKeyword() {
    const line = this.line
    const col = this.column
    let value = ''

    while (this.pos < this.source.length && this.isAlphaNumeric(this.peek())) {
      value += this.peek()
      this.advance()
    }

    // Check if it's a label (followed by colon)
    if (this.peek() === ':') {
      return new Token('LABEL', value, line, col)
    }

    // Check if it's a keyword/instruction
    const upper = value.toUpperCase()
    if (this.isInstruction(upper)) {
      return new Token('INSTRUCTION', upper, line, col)
    }

    // Check if it's a directive
    if (value.startsWith('.')) {
      return new Token('DIRECTIVE', value, line, col)
    }

    return new Token('IDENTIFIER', value, line, col)
  }

  readNumber() {
    const line = this.line
    const col = this.column
    let value = ''
    let isHex = false

    if (this.peek() === '0' && this.peekNext() === 'x') {
      isHex = true
      value += this.peek()
      this.advance()
      value += this.peek()
      this.advance()
    }

    const validChars = isHex
      ? (c) => /[0-9a-fA-F]/.test(c)
      : (c) => this.isDigit(c)

    while (this.pos < this.source.length && validChars(this.peek())) {
      value += this.peek()
      this.advance()
    }

    return new Token('NUMBER', value, line, col)
  }

  readString() {
    const line = this.line
    const col = this.column
    let value = ''
    this.advance() // Skip opening quote

    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance()
        const escaped = this.peek()
        switch (escaped) {
          case 'n':
            value += '\n'
            break
          case 't':
            value += '\t'
            break
          case '\\'
            value += '\\'
            break
          case '"'
            value += '"'
            break
          default:
            value += escaped
        }
        this.advance()
      } else {
        value += this.peek()
        this.advance()
      }
    }

    if (this.peek() !== '"') {
      throw new Error(`Unterminated string at line ${line}:${col}`)
    }
    this.advance() // Skip closing quote

    return new Token('STRING', value, line, col)
  }

  skipWhitespace() {
    while (this.pos < this.source.length && /[ \t\r]/.test(this.peek())) {
      this.advance()
    }
  }

  skipLine() {
    while (this.pos < this.source.length && this.peek() !== '\n') {
      this.advance()
    }
    if (this.peek() === '\n') {
      this.advance()
    }
  }

  isInstruction(word) {
    const instructions = new Set([
      // Arithmetic
      'ADD', 'ADDI', 'ADDIU', 'ADDU', 'SUB', 'SUBU',
      'MUL', 'MULT', 'MULTU', 'DIV', 'DIVU',
      // Logical
      'AND', 'ANDI', 'OR', 'ORI', 'XOR', 'XORI', 'NOR',
      'SLL', 'SRL', 'SRA', 'SLLV', 'SRLV', 'SRAV',
      // Comparison
      'SLT', 'SLTI', 'SLTU', 'SLTIU',
      // Jump & Branch
      'BEQ', 'BNE', 'BGEZ', 'BGTZ', 'BLEZ', 'BLTZ',
      'J', 'JAL', 'JR', 'JALR',
      // Load & Store
      'LW', 'LH', 'LB', 'LHU', 'LBU',
      'SW', 'SH', 'SB',
      'LUI', 'LA',
      // Move
      'MFHI', 'MFLO', 'MTHI', 'MTLO',
      // Pseudo-instructions
      'MOVE', 'LI', 'NOP',
      // Syscall
      'SYSCALL',
    ])
    return instructions.has(word)
  }

  isAlpha(char) {
    return /[a-zA-Z_.]/.test(char)
  }

  isAlphaNumeric(char) {
    return /[a-zA-Z0-9_.]/.test(char)
  }

  isDigit(char) {
    return /[0-9]/.test(char)
  }

  peek(offset = 0) {
    const pos = this.pos + offset
    return pos < this.source.length ? this.source[pos] : ''
  }

  peekNext() {
    return this.peek(1)
  }

  advance() {
    if (this.pos < this.source.length) {
      if (this.source[this.pos] === '\n') {
        this.line++
        this.column = 1
      } else {
        this.column++
      }
      this.pos++
    }
  }
}

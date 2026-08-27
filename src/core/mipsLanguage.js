import * as monaco from 'monaco-editor'

export function registerMipsLanguage() {
  monaco.languages.register({ id: 'mips' })

  monaco.languages.setMonarchTokensProvider('mips', {
    tokenizer: {
      root: [
        // Comments
        [/#.*$/, 'comment'],

        // Directives
        [/\.[a-zA-Z_]\w*/, 'keyword'],

        // Instructions
        [
          /\b(add|addu|addi|addiu|sub|subu|mul|mult|multu|div|divu|and|andi|or|ori|xor|xori|nor|sll|srl|sra|sllv|srlv|srav|slt|slti|sltu|sltiu|beq|bne|bgez|bgtz|blez|bltz|j|jal|jr|jalr|lw|lh|lhu|lb|lbu|sw|sh|sb|lui|la|mfhi|mflo|mthi|mtlo|move|li|nop|syscall)\b/i,
          'keyword',
        ],

        // Registers
        [/\$(zero|at|v[0-1]|a[0-3]|t[0-9]|s[0-7]|k[0-1]|gp|sp|fp|ra|hi|lo|pc)\b/i, 'variable'],
        [/\$\d+/, 'variable'],

        // Labels
        [/^\s*[a-zA-Z_]\w*(?=:)/, 'type'],

        // Numbers
        [/0x[0-9a-fA-F]+/, 'number'],
        [/\d+/, 'number'],

        // Strings
        [/"([^"\\]|\\.)*"/, 'string'],

        // Operators and punctuation
        [/[,():]/, 'operator'],
        [/\s+/, 'white'],
      ],
    },
  })

  // Completion items
  monaco.languages.registerCompletionItemProvider('mips', {
    provideCompletionItems: () => {
      const instructions = [
        'add', 'addu', 'addi', 'addiu', 'sub', 'subu', 'mul', 'mult', 'multu', 'div', 'divu',
        'and', 'andi', 'or', 'ori', 'xor', 'xori', 'nor',
        'sll', 'srl', 'sra', 'sllv', 'srlv', 'srav',
        'slt', 'slti', 'sltu', 'sltiu',
        'beq', 'bne', 'bgez', 'bgtz', 'blez', 'bltz',
        'j', 'jal', 'jr', 'jalr',
        'lw', 'lh', 'lhu', 'lb', 'lbu', 'sw', 'sh', 'sb', 'lui', 'la',
        'mfhi', 'mflo', 'mthi', 'mtlo',
        'move', 'li', 'nop', 'syscall',
      ]

      const registers = [
        '$zero', '$at', '$v0', '$v1',
        '$a0', '$a1', '$a2', '$a3',
        '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
        '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
        '$t8', '$t9', '$k0', '$k1',
        '$gp', '$sp', '$fp', '$ra', '$pc', '$hi', '$lo',
      ]

      return {
        suggestions: [
          ...instructions.map((instr) => ({
            label: instr,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: instr,
            documentation: `MIPS instruction: ${instr}`,
          })),
          ...registers.map((reg) => ({
            label: reg,
            kind: monaco.languages.CompletionItemKind.Variable,
            insertText: reg,
            documentation: `Register: ${reg}`,
          })),
        ],
      }
    },
  })
}

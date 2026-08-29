import * as monaco from 'monaco-editor'

export function registerMipsLanguage(): void {
	monaco.languages.register({ id: 'mips' })

	monaco.languages.setMonarchTokensProvider('mips', {
		tokenizer: {
			root: [
				// Comments
				[/#.*$/, 'comment'],

				// Directives
				[/\.[a-zA-Z_]\w*/, 'keyword'],

				// Coprocessor instructions, before the plain mnemonics so the
				// format suffix is highlighted with them.
				[
					/\b(l\.[sd]|s\.[sd]|li\.[sd]|lwc1|swc1|ldc1|sdc1|mtc1|mfc1|mtc0|mfc0|eret|bc1[tf]|mov[tf]|(?:add|sub|mul|div|abs|neg|sqrt|mov)\.[sd]|c\.(?:eq|lt|le)\.[sd]|cvt\.[sdw]\.[sdw]|(?:round|trunc|ceil|floor)\.w\.[sd])\b/i,
					'keyword',
				],

				// Instructions
				[
					/\b(add|addu|addi|addiu|sub|subu|mul|mult|multu|div|divu|and|andi|or|ori|xor|xori|nor|sll|srl|sra|sllv|srlv|srav|slt|slti|sltu|sltiu|beq|bne|bgez|bgtz|blez|bltz|j|jal|jr|jalr|lw|lh|lhu|lb|lbu|sw|sh|sb|lui|la|mfhi|mflo|mthi|mtlo|move|li|nop|syscall)\b/i,
					'keyword',
				],

				// Macro parameters
				[/%[a-zA-Z_]\w*/, 'variable'],

				// Registers
				[/\$f\d{1,2}\b/i, 'variable'],
				[/\$(zero|at|v[0-1]|a[0-3]|t[0-9]|s[0-7]|k[0-1]|gp|sp|fp|ra|hi|lo|pc)\b/i, 'variable'],
				[/\$\d+/, 'variable'],

				// Labels
				[/^\s*[a-zA-Z_]\w*(?=:)/, 'type'],

				// Numbers
				[/0x[0-9a-fA-F]+/, 'number'],
				[/\d+/, 'number'],

				// Strings and character literals
				[/"([^"\\]|\\.)*"/, 'string'],
				[/'([^'\\]|\\.)'/, 'string'],

				// Operators and punctuation
				[/[,():+-]/, 'operator'],
				[/\s+/, 'white'],
			],
		},
	})

	// Completion items
	monaco.languages.registerCompletionItemProvider('mips', {
		provideCompletionItems: (_model, position) => {
			const range = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column)
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
				'lwc1', 'swc1', 'ldc1', 'sdc1', 'l.s', 'l.d', 's.s', 's.d', 'li.s', 'li.d',
				'mfc1', 'mtc1', 'mfc0', 'mtc0', 'eret', 'bc1t', 'bc1f', 'movf', 'movt',
				'add.s', 'add.d', 'sub.s', 'sub.d', 'mul.s', 'mul.d', 'div.s', 'div.d',
				'abs.s', 'abs.d', 'neg.s', 'neg.d', 'sqrt.s', 'sqrt.d', 'mov.s', 'mov.d',
				'cvt.s.w', 'cvt.s.d', 'cvt.d.w', 'cvt.d.s', 'cvt.w.s', 'cvt.w.d',
				'round.w.s', 'trunc.w.s', 'ceil.w.s', 'floor.w.s',
				'c.eq.s', 'c.eq.d', 'c.lt.s', 'c.lt.d', 'c.le.s', 'c.le.d',
			]

			const registers = [
				'$zero', '$at', '$v0', '$v1',
				'$a0', '$a1', '$a2', '$a3',
				'$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
				'$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
				'$t8', '$t9', '$k0', '$k1',
				'$gp', '$sp', '$fp', '$ra', '$pc', '$hi', '$lo',
				...Array.from({ length: 32 }, (_unused, index) => `$f${index}`),
			]

			return {
				suggestions: [
					...instructions.map((instr) => ({
						label: instr,
						kind: monaco.languages.CompletionItemKind.Keyword,
						insertText: instr,
						range,
						documentation: `MIPS instruction: ${instr}`,
					})),
					...registers.map((reg) => ({
						label: reg,
						kind: monaco.languages.CompletionItemKind.Variable,
						insertText: reg,
						range,
						documentation: `Register: ${reg}`,
					})),
				],
			}
		},
	})
}

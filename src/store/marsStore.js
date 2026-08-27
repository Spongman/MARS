import { create } from 'zustand'

const initialRegisters = {
  $zero: 0,
  $at: 0,
  $v0: 0, $v1: 0,
  $a0: 0, $a1: 0, $a2: 0, $a3: 0,
  $t0: 0, $t1: 0, $t2: 0, $t3: 0, $t4: 0, $t5: 0, $t6: 0, $t7: 0,
  $s0: 0, $s1: 0, $s2: 0, $s3: 0, $s4: 0, $s5: 0, $s6: 0, $s7: 0,
  $t8: 0, $t9: 0,
  $k0: 0, $k1: 0,
  $gp: 0x10008000,
  $sp: 0x7fffeffc,
  $fp: 0,
  $ra: 0,
  $pc: 0x00400000,
  $hi: 0,
  $lo: 0,
}

export const useMarsStore = create((set) => ({
  code: '# Write MIPS assembly code here\naddi $t0, $zero, 5\naddi $t1, $zero, 3\nadd $t2, $t0, $t1\n',
  registers: initialRegisters,
  memory: {},
  console: '',
  currentLine: 0,
  isRunning: false,

  setCode: (newCode) => set({ code: newCode }),

  setRegisters: (newRegisters) => set({ registers: newRegisters }),

  setMemory: (newMemory) => set({ memory: newMemory }),

  appendConsole: (text) => set((state) => ({
    console: state.console + text + '\n',
  })),

  clearConsole: () => set({ console: '' }),

  run: () => set((state) => {
    // Placeholder for MIPS execution logic
    // TODO: Implement MIPS assembler and runtime
    set({ console: 'Program started...\n' })
    return { isRunning: true }
  }),

  reset: () => set({
    registers: initialRegisters,
    memory: {},
    console: '',
    currentLine: 0,
    isRunning: false,
  }),
}))

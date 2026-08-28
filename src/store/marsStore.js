import { create } from 'zustand'
import { Assembler } from '../core/assembler'
import { MipsSimulator } from '../core/simulator'

const initialRegisters = {
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

export const useMarsStore = create((set, get) => {
  let simulator = null

  return {
    code: '# Simple addition example\n# $t0 = 5, $t1 = 3, $t2 = $t0 + $t1\naddi $t0, $zero, 5\naddi $t1, $zero, 3\nadd $t2, $t0, $t1\n\n# Print result (syscall 1)\nmove $a0, $t2\naddi $v0, $zero, 1\nsyscall\n\n# Exit (syscall 10)\naddi $v0, $zero, 10\nsyscall\n',
    registers: initialRegisters,
    memory: {},
    console: '',
    currentLine: 0,
    isRunning: false,
    isPaused: false,
    breakpoints: new Set(),
    executionHistory: [],

    setCode: (newCode) => set({ code: newCode }),

    setRegisters: (newRegisters) => set({ registers: newRegisters }),

    setMemory: (newMemory) => set({ memory: newMemory }),

    appendConsole: (text) =>
      set((state) => ({
        console: state.console + text,
      })),

    clearConsole: () => set({ console: '' }),

    run: async () => {
      return new Promise((resolve, reject) => {
        set((state) => {
          try {
            const assembler = new Assembler(state.code)
            const { program, machineCode } = assembler.assemble()

            simulator = new MipsSimulator(machineCode, program)
            simulator.run()

            const finalState = simulator.getState()

            return {
              registers: finalState.registers,
              memory: finalState.memory,
              console: finalState.console,
              isRunning: false,
              isPaused: finalState.paused,
              executionHistory: simulator.getExecutionHistory(),
            }
          } catch (error) {
            reject(error)
            return state
          }
        })
        resolve()
      })
    },

    step: () => {
      if (!simulator) {
        const state = get()
        try {
          const assembler = new Assembler(state.code)
          const { program, machineCode } = assembler.assemble()
          simulator = new MipsSimulator(machineCode, program)
        } catch (error) {
          set({ console: `Error: ${error.message}` })
          return
        }
      }

      simulator.step()
      const finalState = simulator.getState()

      set({
        registers: finalState.registers,
        memory: finalState.memory,
        console: finalState.console,
        isPaused: true,
      })
    },

    stepOver: () => {
      if (!simulator) return
      simulator.stepOver()
      const finalState = simulator.getState()

      set({
        registers: finalState.registers,
        memory: finalState.memory,
        console: finalState.console,
        isPaused: true,
      })
    },

    pause: () => {
      if (simulator) {
        simulator.paused = true
        simulator.running = false
        const finalState = simulator.getState()
        set({
          isPaused: true,
          isRunning: false,
          registers: finalState.registers,
          memory: finalState.memory,
        })
      }
    },

    continue: () => {
      if (simulator) {
        simulator.continue()
        const finalState = simulator.getState()
        set({
          registers: finalState.registers,
          memory: finalState.memory,
          console: finalState.console,
          isPaused: finalState.paused,
          isRunning: false,
        })
      }
    },

    addBreakpoint: (address) => {
      if (simulator) {
        simulator.addBreakpoint(address)
        set((state) => ({
          breakpoints: new Set(simulator.getBreakpoints()),
        }))
      }
    },

    removeBreakpoint: (address) => {
      if (simulator) {
        simulator.removeBreakpoint(address)
        set((state) => ({
          breakpoints: new Set(simulator.getBreakpoints()),
        }))
      }
    },

    toggleBreakpoint: (address) => {
      if (simulator) {
        simulator.toggleBreakpoint(address)
        set((state) => ({
          breakpoints: new Set(simulator.getBreakpoints()),
        }))
      }
    },

    reset: () =>
      set({
        registers: initialRegisters,
        memory: {},
        console: '',
        currentLine: 0,
        isRunning: false,
        isPaused: false,
        breakpoints: new Set(),
        executionHistory: [],
      }),
  }
})

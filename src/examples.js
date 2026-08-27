/**
 * Example MIPS Programs
 */

export const EXAMPLES = {
  sum: {
    name: 'Sum of Numbers',
    description: 'Add 5 + 3 and print the result',
    code: `# Simple addition example
# Compute 5 + 3 = 8

.text

main:
  # Load values
  addi $t0, $zero, 5      # $t0 = 5
  addi $t1, $zero, 3      # $t1 = 3
  
  # Add them
  add $t2, $t0, $t1       # $t2 = $t0 + $t1 = 8
  
  # Print result
  move $a0, $t2           # $a0 = $t2 (argument for syscall)
  addi $v0, $zero, 1      # $v0 = 1 (print integer syscall)
  syscall
  
  # Print newline
  addi $a0, $zero, 10     # ASCII code for newline
  addi $v0, $zero, 11     # $v0 = 11 (print character syscall)
  syscall
  
  # Exit
  addi $v0, $zero, 10     # $v0 = 10 (exit syscall)
  syscall
`,
  },

  factorial: {
    name: 'Factorial',
    description: 'Compute 5! (5 factorial) = 120',
    code: `# Factorial example
# Compute 5! = 5 * 4 * 3 * 2 * 1 = 120

.text

main:
  addi $t0, $zero, 5      # n = 5
  addi $t1, $zero, 1      # result = 1
  
loop:
  beq $t0, $zero, done    # if n == 0, exit loop
  mul $t1, $t1, $t0       # result = result * n
  addi $t0, $t0, -1       # n--
  j loop
  
done:
  # Print result
  move $a0, $t1
  addi $v0, $zero, 1
  syscall
  
  # Exit
  addi $v0, $zero, 10
  syscall
`,
  },

  fibonacci: {
    name: 'Fibonacci',
    description: 'Compute the 10th Fibonacci number',
    code: `# Fibonacci sequence
# Compute fib(10)

.text

main:
  addi $t0, $zero, 0      # fib(0) = 0
  addi $t1, $zero, 1      # fib(1) = 1
  addi $t2, $zero, 10     # counter = 10
  addi $t3, $zero, 2      # i = 2
  
loop:
  bgt $t3, $t2, done      # if i > 10, exit
  add $t4, $t0, $t1       # temp = fib(n-2) + fib(n-1)
  move $t0, $t1           # fib(n-2) = fib(n-1)
  move $t1, $t4           # fib(n-1) = temp
  addi $t3, $t3, 1        # i++
  j loop
  
done:
  # Print result
  move $a0, $t1
  addi $v0, $zero, 1
  syscall
  
  # Exit
  addi $v0, $zero, 10
  syscall
`,
  },

  loop: {
    name: 'Loop Counter',
    description: 'Print numbers from 1 to 5',
    code: `# Loop counter example
# Print numbers 1 through 5

.text

main:
  addi $t0, $zero, 1      # counter = 1
  
loop:
  addi $t1, $zero, 6      # load 6 for comparison
  beq $t0, $t1, done      # if counter == 6, exit
  
  # Print counter
  move $a0, $t0
  addi $v0, $zero, 1
  syscall
  
  # Print space
  addi $a0, $zero, 32     # ASCII space
  addi $v0, $zero, 11
  syscall
  
  # Increment and loop
  addi $t0, $t0, 1
  j loop
  
done:
  # Print newline
  addi $a0, $zero, 10
  addi $v0, $zero, 11
  syscall
  
  # Exit
  addi $v0, $zero, 10
  syscall
`,
  },

  bitwise: {
    name: 'Bitwise Operations',
    description: 'Demonstrate AND, OR, XOR operations',
    code: `# Bitwise operations
# Test AND, OR, XOR with two values

.text

main:
  addi $t0, $zero, 12     # $t0 = 12 (binary: 1100)
  addi $t1, $zero, 10     # $t1 = 10 (binary: 1010)
  
  # AND operation
  and $t2, $t0, $t1       # $t2 = 12 & 10 = 8
  move $a0, $t2
  addi $v0, $zero, 1
  syscall
  
  addi $a0, $zero, 32
  addi $v0, $zero, 11
  syscall
  
  # OR operation
  or $t2, $t0, $t1        # $t2 = 12 | 10 = 14
  move $a0, $t2
  addi $v0, $zero, 1
  syscall
  
  addi $a0, $zero, 32
  addi $v0, $zero, 11
  syscall
  
  # XOR operation
  xor $t2, $t0, $t1       # $t2 = 12 ^ 10 = 6
  move $a0, $t2
  addi $v0, $zero, 1
  syscall
  
  # Exit
  addi $v0, $zero, 10
  syscall
`,
  },
}

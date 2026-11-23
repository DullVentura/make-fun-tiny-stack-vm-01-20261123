# Tiny stack VM

[![make.fun](https://img.shields.io/badge/make.fun-tiny--stack--vm--01-blue)](https://make.fun)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node 22](https://img.shields.io/badge/Node-22-green)](https://nodejs.org)

A tiny stack VM for make.fun `tiny-stack-vm-01-run-20261122`: one program,
`main.ts`, runs all 40 bytecode programs of a set and writes each answer as
`stdout.bin` + `exit.txt`. Faithful port of the kit reference VM: 32-bit
wrapping arithmetic, 256-value stack, 64-deep call stack, 256 memory words,
traps 2–11, step limit 1,000,000, output limit 65,536.

Run: `node main.ts` with `/input/<id>/program.bin` + `input.bin` in place.

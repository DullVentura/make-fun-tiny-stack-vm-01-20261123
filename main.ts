// Tiny stack VM, rewritten from ISA.md with vm.mjs as reference: 32-bit wrapping
// values, 256-value stack, 64-deep call stack, 256 memory words, traps 2-11.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const txt = new TextEncoder();

// Binary op: returns [value, trap] where trap is 0 on success, 4 on div-by-zero.
// a is the second-from-top, b the top of the stack.
function bin(op, a, b) {
  switch (op) {
    case 0x10: return [(a + b) | 0, 0];
    case 0x11: return [(a - b) | 0, 0];
    case 0x12: return [Math.imul(a, b), 0];
    case 0x13:
      if (!b) return [0, 4];
      return [a === -2147483648 && b === -1 ? a : (a / b) | 0, 0];
    case 0x14:
      if (!b) return [0, 4];
      return [b === -1 ? 0 : (a % b) | 0, 0];
    case 0x15:
      if (!b) return [0, 4];
      return [Math.floor((a >>> 0) / (b >>> 0)) | 0, 0];
    case 0x16:
      if (!b) return [0, 4];
      return [((a >>> 0) % (b >>> 0)) | 0, 0];
    case 0x18: return [a & b, 0];
    case 0x19: return [a | b, 0];
    case 0x1a: return [a ^ b, 0];
    case 0x1c: return [a << (b & 31), 0];
    case 0x1d: return [a >> (b & 31), 0];
    case 0x1e: return [(a >>> (b & 31)) | 0, 0];
    case 0x20: return [a === b ? 1 : 0, 0];
    case 0x21: return [a < b ? 1 : 0, 0];
    default: return [(a >>> 0) < (b >>> 0) ? 1 : 0, 0]; // 0x22 LTU
  }
}

// Immediate length in bytes for an opcode byte.
function immLen(op) {
  if (op === 1) return 1;
  if (op === 2) return 4;
  if (op >= 0x30 && op <= 0x33) return 2;
  return 0;
}

// [pops, pushes] for an opcode byte, per the ISA stack pictures.
function need(op) {
  if (op === 1 || op === 2 || op === 0x52) return [0, 1];
  if (op === 3 || op === 0x31 || op === 0x32 || op === 0x50 || op === 0x51 || op === 0x53) return [1, 0];
  if (op === 0x40) return [1, 1]; // LOAD: pops address, pushes value
  if (op === 4) return [1, 2];
  if (op === 6) return [2, 3];
  if (op === 7) return [3, 3];
  if (op === 5) return [2, 2];
  if (op === 0x41) return [2, 0];
  if (op === 0x17 || op === 0x1b) return [1, 1];
  if (op >= 0x10 && op <= 0x22) return [2, 1];
  return [0, 0]; // HALT, JMP, CALL, RET
}

function run(prog, inp) {
  const S = new Int32Array(256), R = new Int32Array(64), M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, rp = 0, pc = 0, steps = 0, olen = 0, ipos = 0;
  const n = prog.length;
  const done = (code) => ({ o: out.slice(0, olen), e: code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = prog[pc];
    // Valid opcodes: 00-07, 10-22, 30-34, 40-41, 50-53. Everything else: trap 5.
    if (op > 0x53 || (op > 0x41 && op < 0x50) || (op > 0x34 && op < 0x40) || (op > 0x22 && op < 0x30) || (op > 7 && op < 0x10)) return done(5);
    const imm = immLen(op);
    if (pc + imm >= n) return done(9); // immediate cut off by the program's end
    steps++;
    const [pops, pushes] = need(op);
    if (sp < pops) return done(2);
    if (sp - pops + pushes > 256) return done(3);
    const nxt = pc + 1 + imm;
    pc = nxt;
    if (op >= 0x10 && op <= 0x22 && op !== 0x17 && op !== 0x1b) {
      const [v, t] = bin(op, S[sp - 2], S[sp - 1]);
      if (t) return done(t);
      sp -= 2;
      S[sp++] = v;
      continue;
    }
    switch (op) {
      case 0x00: return done(0);
      case 0x01: S[sp++] = (prog[nxt - 1] << 24) >> 24; break; // PUSH8 sign-extended
      case 0x02: S[sp++] = prog[nxt - 4] | (prog[nxt - 3] << 8) | (prog[nxt - 2] << 16) | (prog[nxt - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: S[sp] = S[sp - 1]; sp++; break;
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; }
      case 0x06: S[sp] = S[sp - 2]; sp++; break;
      case 0x07: { const t = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = t; break; }
      case 0x17: S[sp - 1] = -S[sp - 1] | 0; break;
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((prog[nxt - 2] | (prog[nxt - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          const v = S[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = nxt + rel;
        break;
      }
      case 0x33:
        if (rp === 64) return done(7);
        R[rp++] = nxt;
        pc = prog[nxt - 2] | (prog[nxt - 1] << 8);
        break;
      case 0x34:
        if (rp === 0) return done(8);
        pc = R[--rp];
        break;
      case 0x40: {
        const a = S[sp - 1];
        if (a < 0 || a > 255) return done(6);
        S[sp - 1] = M[a];
        break;
      }
      case 0x41: {
        const a = S[sp - 1];
        if (a < 0 || a > 255) return done(6);
        M[a] = S[sp - 2];
        sp -= 2;
        break;
      }
      case 0x50: {
        const g = String(S[sp - 1]);
        if (olen + g.length > 65536) return done(11);
        out.set(txt.encode(g), olen);
        olen += g.length;
        sp--;
        break;
      }
      case 0x51:
        if (olen + 1 > 65536) return done(11);
        out[olen++] = S[--sp] & 255;
        break;
      case 0x52:
        S[sp++] = ipos < inp.length ? inp[ipos++] : -1;
        break;
      case 0x53:
        return done(S[--sp] & 255);
      default:
        return done(5);
    }
  }
}

const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(IN).sort()) {
  const r = run(new Uint8Array(readFileSync(join(IN, id, 'program.bin'))), new Uint8Array(readFileSync(join(IN, id, 'input.bin'))));
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), r.o);
  writeFileSync(join(OUT, id, 'exit.txt'), `${r.e}\n`);
}

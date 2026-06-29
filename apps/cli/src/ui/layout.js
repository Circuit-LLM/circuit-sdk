// Layout primitives — width math, centring, dividers. ANSI-aware.
import { c, sym } from '../theme.js';

const ANSI = /\x1B\[[0-9;]*m/g;
export const stripAnsi = (s) => String(s).replace(ANSI, '');
export const width = (s) => stripAnsi(s).length;
export const cols = () => Math.max(40, process.stdout.columns || 80);
export const rows = () => Math.max(10, process.stdout.rows || 24);

// 2J (clear screen) + H (home). Deliberately NOT 3J (wipe scrollback) — 3J is sluggish on the
// Windows console and added visible lag to every screen redraw for no real benefit.
export const clearScreen = () => process.stdout.write('\x1B[2J\x1B[H');
export { sleep } from '../util/async.js'; // single source; services import it from util/, not ui/

export function center(line, w = cols()) {
  const pad = Math.max(0, Math.floor((w - width(line)) / 2));
  return ' '.repeat(pad) + line;
}

export function centerBlock(block, w = cols()) {
  const lines = String(block).split('\n');
  const widest = Math.max(...lines.map(width));
  const pad = Math.max(0, Math.floor((w - widest) / 2));
  return lines.map((l) => ' '.repeat(pad) + l).join('\n');
}

export function splitLine(left, right, w = cols()) {
  const gap = Math.max(1, w - width(left) - width(right));
  return left + ' '.repeat(gap) + right;
}

export function padEndV(s, w) {
  const diff = w - width(s);
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

export function divider(w = cols(), char = sym.hbar) {
  return c.dim(char.repeat(w));
}

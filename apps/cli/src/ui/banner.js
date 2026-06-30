// The hero banner — a gradient "CIRCUIT" wordmark centred to the terminal,
// with a graceful compact fallback for narrow windows.
import figlet from 'figlet';
import { brand, c, sym } from '../theme.js';
import { center, cols } from './layout.js';

export function renderBanner() {
  const w = cols();
  let plain = null;
  try {
    plain = figlet.textSync('CIRCUIT', { font: 'ANSI Shadow' });
  } catch {
    plain = null;
  }

  if (plain && w >= 56) {
    const lines = plain.replace(/\s+$/, '').split('\n');
    const widest = Math.max(...lines.map((l) => l.length));
    const pad = ' '.repeat(Math.max(0, Math.floor((w - widest) / 2)));
    // Gradient the unpadded art so colour starts on the first glyph.
    return lines.map((l) => pad + brand(l)).join('\n');
  }
  return center(brand('C I R C U I T'), w);
}

export function renderWordmark() {
  const text = `${c.muted('L  L  M')}   ${c.dim(sym.diamondO)}   ${c.accent(
    'decentralized intelligence',
  )}`;
  return center(text, cols());
}

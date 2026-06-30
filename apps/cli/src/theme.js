// The Circuit design system — one place for every colour, gradient and glyph.
// Swap the palette here and the whole CLI re-skins.
import chalk from 'chalk';

// Circuit brand — warm gold/yellow on near-black, matching the dashboards and
// circuitllm.xyz. The signature is electric yellow (#ffe000); gold and bright
// flank it for accents and glow.
export const palette = {
  gold: '#dcb820', // primary accent
  yellow: '#ffe000', // signature / high-emphasis
  bright: '#ffe880', // glow / gradient tip
  amber: '#ffa42a', // secondary warm accent
  green: '#8ada6e',
  red: '#ff5c5c',
  text: '#efe4b4', // warm cream
  muted: '#cabb7e',
  dim: '#5a4e1a',
};

// Brand mark — solid signature yellow, no gradient. (Was a gold→yellow→bright sweep; the flat
// single-colour wordmark reads cleaner, especially the big CIRCUIT on the landing page.)
export const brand = (s) => chalk.hex(palette.yellow)(s);
export const brandAlt = (s) => chalk.hex(palette.amber)(s);
export const grad = (..._stops) => (s) => chalk.hex(palette.yellow)(s);

// Semantic colours.
export const c = {
  accent: chalk.hex(palette.gold),
  text: chalk.hex(palette.text),
  muted: chalk.hex(palette.muted),
  dim: chalk.hex(palette.dim),
  ok: chalk.hex(palette.green),
  warn: chalk.hex(palette.amber),
  err: chalk.hex(palette.red),
  bold: chalk.bold,
};

// Glyph set — kept unicode-light so it renders on most terminals.
export const sym = {
  dot: '●',
  ring: '○',
  diamond: '◆',
  diamondO: '◇',
  bolt: '↯',
  spark: '✦',
  chevron: '›',
  arrow: '▸',
  hbar: '─',
  vbar: '│',
  node: '⬡',
  cube: '▣',
  stack: '⛁',
  check: '✔',
  cross: '✕',
  circuit: '◈',
};

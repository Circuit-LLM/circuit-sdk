// Reusable visual components — all pure (data → string), no domain logic.
import chalk from 'chalk';
import boxen from 'boxen';
import { c, palette, sym, brand } from '../theme.js';
import { width, padEndV } from './layout.js';

// Pill badge.
export function badge(text, kind = 'accent') {
  const map = {
    accent: chalk.bgHex(palette.gold).black,
    ok: chalk.bgHex(palette.green).black,
    warn: chalk.bgHex(palette.amber).black,
    err: chalk.bgHex(palette.red).black,
    dim: chalk.bgHex(palette.dim).black,
  };
  return (map[kind] || map.accent).bold(` ${String(text).toUpperCase()} `);
}

// Coloured status dot + label.
export function statusDot(ok, label) {
  return ok ? `${c.ok(sym.dot)} ${c.text(label)}` : `${c.dim(sym.ring)} ${c.muted(label)}`;
}

// Rounded, titled panel.
export function panel(body, { title, color = palette.gold, padding } = {}) {
  return boxen(body, {
    padding: padding ?? { top: 1, bottom: 1, left: 3, right: 3 },
    borderStyle: 'round',
    borderColor: color,
    title: title ? c.accent.bold(title) : undefined,
    titleAlignment: 'left',
  });
}

// A section heading.
export function heading(text, icon = sym.diamond) {
  return `${c.accent(icon)}  ${brand(text)}`;
}

// Key / value row with an aligned key column.
export function kv(key, value, keyWidth = 12) {
  return `${c.muted(padEndV(key, keyWidth))} ${value}`;
}

export function bullet(text, mark = sym.arrow) {
  return `  ${c.accent(mark)} ${c.text(text)}`;
}

// Simple aligned table. columns: [{ key, label, align?, color? }]
export function table(rows, columns, { gap = 2 } = {}) {
  const widths = columns.map((col) =>
    Math.max(
      width(col.label),
      ...rows.map((r) => width(String(r[col.key] ?? ''))),
    ),
  );
  const sep = ' '.repeat(gap);
  const head = columns
    .map((col, i) => c.dim(fit(col.label, widths[i], col.align)))
    .join(sep);
  const body = rows
    .map((r) =>
      columns
        .map((col, i) => {
          const raw = String(r[col.key] ?? '—');
          const colored = col.color ? col.color(r) : (s) => s;
          return colored(fit(raw, widths[i], col.align));
        })
        .join(sep),
    )
    .join('\n');
  return `${head}\n${body}`;
}

function fit(s, w, align = 'left') {
  const diff = w - width(s);
  if (diff <= 0) return s;
  return align === 'right' ? ' '.repeat(diff) + s : s + ' '.repeat(diff);
}

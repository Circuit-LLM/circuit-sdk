// Terminal charts — an inline sparkline and a braille line chart.
import { c, brand, palette } from '../theme.js';
import chalk from 'chalk';

const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

// One-line sparkline from a series of values.
export function sparkline(values, color = c.accent) {
  const vals = (values || []).filter((v) => isFinite(v));
  if (vals.length < 2) return c.dim('—');
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  return color(
    vals.map((v) => BLOCKS[Math.min(7, Math.floor(((v - min) / span) * 7.999))]).join(''),
  );
}

// Braille line chart. Returns an array of coloured rows (no side effects).
// width/height are in characters; the canvas is width*2 × height*4 dots.
export function brailleChart(values, { width = 60, height = 12 } = {}) {
  const vals = (values || []).filter((v) => isFinite(v));
  if (vals.length < 2) return [c.dim('  (not enough data to chart)')];

  const W = width * 2;
  const H = height * 4;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  // Resample the series to W x-positions and plot, joining consecutive points.
  const grid = Array.from({ length: H }, () => new Uint8Array(W));
  const yAt = (v) => Math.min(H - 1, Math.max(0, Math.round((1 - (v - min) / span) * (H - 1))));
  const sample = (px) => {
    const t = (px / (W - 1)) * (vals.length - 1);
    const i = Math.floor(t);
    const f = t - i;
    const a = vals[i];
    const b = vals[Math.min(vals.length - 1, i + 1)];
    return a + (b - a) * f;
  };

  let prevY = yAt(sample(0));
  for (let px = 0; px < W; px++) {
    const y = yAt(sample(px));
    const lo = Math.min(prevY, y);
    const hi = Math.max(prevY, y);
    for (let yy = lo; yy <= hi; yy++) grid[yy][px] = 1;
    prevY = y;
  }

  // 2×4 dot → braille bit map.
  const DOT = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ];
  const out = [];
  for (let cy = 0; cy < height; cy++) {
    let line = '';
    for (let cx = 0; cx < width; cx++) {
      let bits = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          if (grid[cy * 4 + dy][cx * 2 + dx]) bits |= DOT[dy][dx];
        }
      }
      line += String.fromCharCode(0x2800 + bits);
    }
    out.push(brand(line));
  }
  // y-axis labels (max at top, min at bottom).
  out[0] += c.dim('  ' + fmtAxis(max));
  out[out.length - 1] += c.dim('  ' + fmtAxis(min));
  return out;
}

function fmtAxis(v) {
  const a = Math.abs(v);
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return '0';
  return v.toPrecision(3);
}

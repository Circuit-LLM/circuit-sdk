// The landing-page intro: a yellow mesh wires itself up around the CIRCUIT wordmark, then comes
// alive as signal pulses route through it. Pure terminal, no deps beyond chalk + figlet.
//
// Robustness (this is the second cut — the first drifted on Windows):
//   • ABSOLUTE repaint — every frame homes the cursor (ESC[H) and clears downward (ESC[J). No
//     relative cursor-up math, so nothing cascades when the terminal scrolls.
//   • Fits-in-viewport or it bails — if the window is too short/narrow the caller draws the static
//     banner instead. We never render a region taller than the screen.
//   • Safe glyphs only — nodes ● / ○ and edge dots ·, all of which the CLI already renders. No
//     width-ambiguous hexagons.
//   • Bulletproof teardown — the cursor and raw-mode are always restored; any throw → static banner.
//   • Escape hatch — CIRCUIT_NO_ANIM=1 skips it entirely.
import chalk from 'chalk';
import figlet from 'figlet';
import { palette } from '../theme.js';
import { cols } from './layout.js';

const ESC = '\x1b';
const HOME = `${ESC}[H`;
const CLR_DOWN = `${ESC}[J`;
const CLR_ALL = `${ESC}[2J${ESC}[H`;
const HIDE = `${ESC}[?25l`;
const SHOW = `${ESC}[?25h`;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic PRNG — the mesh looks the same every launch (brand identity).
function lcg(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0xffffffff;
}

let _art;
function art() {
  if (_art) return _art;
  try {
    _art = figlet.textSync('CIRCUIT', { font: 'ANSI Shadow' }).replace(/\s+$/, '').split('\n');
  } catch {
    _art = ['C I R C U I T'];
  }
  return _art;
}

// Bresenham cell-line, endpoints dropped (the nodes draw themselves).
function linePts(a, b) {
  const pts = [];
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
  return pts.slice(1, -1);
}

// Lay out the wordmark + a ring of mesh nodes/edges in the margins around it.
function buildScene(W) {
  const lines = art();
  const artW = Math.max(...lines.map((l) => l.length));
  const artH = lines.length;
  const artTop = 2;
  const H = artH + 4; // 2-row mesh band above + below
  const artLeft = Math.floor((W - artW) / 2);
  const inArt = (x, y) => y >= artTop && y < artTop + artH && x >= artLeft - 1 && x <= artLeft + artW;

  const rnd = lcg(0x0c1c2173);
  const nodes = [];
  const want = clamp(Math.floor(W / 3.2), 16, 40); // denser, wider field
  let guard = 0;
  while (nodes.length < want && guard++ < 3000) {
    const x = 1 + Math.floor(rnd() * (W - 2));
    const y = Math.floor(rnd() * H);
    if (inArt(x, y)) continue;
    if (nodes.some((n) => Math.abs(n.x - x) <= 2 && Math.abs(n.y - y) <= 1)) continue;
    nodes.push({ x, y, ph: Math.floor(rnd() * 6) });
  }

  // Connect near nodes (cells are ~1:2, so weight y by 2), cap degree at 3.
  const deg = nodes.map(() => 0);
  const d2 = (a, b) => (a.x - b.x) ** 2 + ((a.y - b.y) * 2) ** 2;
  const pairs = [];
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) pairs.push([i, j, d2(nodes[i], nodes[j])]);
  pairs.sort((a, b) => a[2] - b[2]);
  const edges = [];
  for (const [i, j, d] of pairs) {
    if (d > 28 * 28) continue;
    if (deg[i] >= 3 || deg[j] >= 3) continue;
    edges.push({ a: i, b: j, trail: linePts(nodes[i], nodes[j]) });
    deg[i] += 1;
    deg[j] += 1;
  }
  // adjacency for the routing pulses (only edges with a drawable trail)
  const adj = nodes.map(() => []);
  edges.forEach((e, ei) => {
    if (!e.trail.length) return;
    adj[e.a].push({ ei, fwd: true });
    adj[e.b].push({ ei, fwd: false });
  });

  return { lines, artW, artH, H, artTop, artLeft, inArt, nodes, edges, adj, rnd };
}

const cWord = chalk.hex(palette.yellow).bold; // signature yellow wordmark
const cLit = chalk.hex(palette.bright); // a lit node
const cDim = chalk.hex('#7d6c22'); // an unlit node / edge dot
const cPulse = chalk.hex('#fff6cf'); // a routing pulse, brightest

// Render one frame to an array of (left-padded, coloured) row strings.
function frameRows(scene, f, frames, termW, W, signals) {
  const { lines, artH, H, artTop, artLeft, inArt, nodes, edges } = scene;
  const buf = Array.from({ length: H }, () => Array(W).fill(0)); // 0 empty,1 edge,2 dimNode,3 litNode,4 pulse

  const nodePhase = Math.max(1, Math.floor(frames * 0.3));
  const nodesIn = clamp(Math.ceil(((f + 1) / nodePhase) * nodes.length), 0, nodes.length);
  const edgeStart = Math.floor(frames * 0.28);
  const edgeLen = Math.max(1, Math.floor(frames * 0.4));
  const edgeProg = clamp((f - edgeStart) / edgeLen, 0, 1);
  const holding = f >= edgeStart + edgeLen;

  const put = (x, y, v) => {
    if (y < 0 || y >= H || x < 0 || x >= W || inArt(x, y)) return;
    if (v > buf[y][x]) buf[y][x] = v; // brighter wins
  };

  // edges drawing in
  for (const e of edges) {
    const show = Math.floor(e.trail.length * edgeProg);
    for (let p = 0; p < show; p++) put(e.trail[p].x, e.trail[p].y, 1);
  }
  // nodes: lit once their phase arrives; before the hold they glow in dim then brighten
  for (let n = 0; n < nodesIn; n++) {
    const nd = nodes[n];
    const lit = holding || f - n > 2;
    put(nd.x, nd.y, lit ? 3 : 2);
  }
  // routing pulses (hold only)
  if (signals) for (const s of signals) {
    const tr = edges[s.ei]?.trail;
    if (!tr || !tr.length) continue;
    const pt = s.fwd ? tr[clamp(s.pos, 0, tr.length - 1)] : tr[clamp(tr.length - 1 - s.pos, 0, tr.length - 1)];
    if (pt) put(pt.x, pt.y, 4);
  }
  // wordmark on top, always
  for (let r = 0; r < artH; r++) {
    const row = lines[r];
    for (let x = 0; x < row.length; x++) if (row[x] !== ' ') buf[artTop + r][artLeft + x] = 5;
  }

  const pad = ' '.repeat(Math.max(0, Math.floor((termW - W) / 2)));
  const rows = [];
  for (let y = 0; y < H; y++) {
    let line = pad;
    for (let x = 0; x < W; x++) {
      const v = buf[y][x];
      if (v === 5) line += cWord(lines[y - artTop][x - artLeft]);
      else if (v === 4) line += cPulse('●');
      else if (v === 3) line += cLit('●');
      else if (v === 2) line += cDim('○');
      else if (v === 1) line += cDim('·');
      else line += ' ';
    }
    rows.push(line);
  }
  return rows;
}

// Advance the routing pulses one step; reroute at nodes.
function stepSignals(scene, signals) {
  const { edges, adj, rnd } = scene;
  for (const s of signals) {
    const tr = edges[s.ei]?.trail;
    if (!tr || !tr.length) { s.pos = 0; s.ei = pickEdge(scene); s.fwd = true; continue; }
    s.pos += 1;
    if (s.pos >= tr.length) {
      const arrived = s.fwd ? edges[s.ei].b : edges[s.ei].a;
      const opts = adj[arrived].filter((o) => o.ei !== s.ei);
      const next = (opts.length ? opts : adj[arrived])[Math.floor(rnd() * Math.max(1, (opts.length ? opts : adj[arrived]).length))];
      if (next) { s.ei = next.ei; s.fwd = next.fwd; s.pos = 0; }
      else { s.ei = pickEdge(scene); s.fwd = true; s.pos = 0; }
    }
  }
}
function pickEdge(scene) {
  const drawable = scene.edges.map((e, i) => (e.trail.length ? i : -1)).filter((i) => i >= 0);
  return drawable.length ? drawable[Math.floor(scene.rnd() * drawable.length)] : 0;
}

// The settled frame, for the static fallback / preview.
export function meshStill() {
  const termW = cols();
  const W = Math.min(termW, 124);
  const scene = buildScene(W);
  return frameRows(scene, 999, 30, termW, W, null).join('\n');
}

export async function playMeshIntro({ frames = 30, frameMs = 60 } = {}) {
  if (process.env.CIRCUIT_NO_ANIM) throw new Error('disabled');
  const out = process.stdout;
  if (!out.isTTY) throw new Error('no-tty');
  const termW = cols();
  const termH = out.rows || 24;
  const W = Math.min(termW, 124);
  const scene = buildScene(W);
  if (W < scene.artW + 8 || termH < scene.H + 2) throw new Error('too-small'); // → static banner

  const stdin = process.stdin;
  const stdinTty = !!stdin.isTTY;
  let skip = false;
  let rawPrev;
  const onKey = (d) => {
    if (d && d[0] === 3) { out.write(`${SHOW}\n`); process.exit(0); }
    skip = true;
  };

  // pulses start a couple steps apart so they don't overlap
  const signals = [];
  for (let k = 0; k < Math.min(5, scene.edges.filter((e) => e.trail.length).length); k++) {
    signals.push({ ei: pickEdge(scene), fwd: true, pos: -k * 2 });
  }
  const holdStart = Math.floor(frames * 0.28) + Math.max(1, Math.floor(frames * 0.4));

  try {
    out.write(HIDE + CLR_ALL);
    if (stdinTty) {
      rawPrev = stdin.isRaw;
      try { stdin.setRawMode(true); } catch { /* some TTYs */ }
      stdin.resume();
      stdin.on('data', onKey);
    }
    for (let f = 0; f < frames; f++) {
      const ff = skip ? frames - 1 : f;
      if (ff >= holdStart) stepSignals(scene, signals);
      const rows = frameRows(scene, ff, frames, termW, W, ff >= holdStart ? signals : null);
      out.write(HOME + rows.join('\n') + CLR_DOWN);
      if (skip) break;
      await delay(frameMs);
    }
    out.write('\n'); // park the cursor below the mesh for the rest of the splash
  } finally {
    if (stdinTty) {
      stdin.removeListener('data', onKey);
      try { stdin.setRawMode(rawPrev || false); } catch { /* noop */ }
      stdin.pause();
      // Discard any leftover bytes from a skip-keypress (e.g. an arrow's ESC [ A tail) so the
      // splash's "press any key" and the menu start from a clean stdin — avoids the input stall.
      try { while (stdin.read() !== null) { /* drain */ } } catch { /* noop */ }
    }
    out.write(SHOW);
  }
}

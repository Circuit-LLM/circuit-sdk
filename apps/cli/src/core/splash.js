// The first-load screen: hero banner, a live mesh probe, and a system panel.
import boxen from 'boxen';
import { config } from '../config.js';
import {
  c, palette, sym, renderBanner, renderWordmark, clearScreen, center, centerBlock, sleep, spinner,
} from '../ui/index.js';
import { playMeshIntro } from '../ui/meshIntro.js';

async function checkMesh() {
  try {
    const r = await fetch(config.endpoints.health, { signal: AbortSignal.timeout(2500) });
    return { online: r.ok };
  } catch {
    return { online: false };
  }
}

function infoPanel(status) {
  const rows = [
    [sym.spark, 'Version', c.text(config.version)],
    [sym.circuit, 'Network', status.online ? c.ok(`${sym.dot} online`) : c.muted(`${sym.ring} offline`)],
    [sym.bolt, 'Model', c.text(config.model)],
    [sym.node, 'Endpoint', c.accent(config.web)],
  ];
  const body = rows.map(([ic, k, v]) => `${c.accent(ic)}  ${c.muted(k.padEnd(8))}  ${v}`).join('\n');
  return centerBlock(
    boxen(body, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      borderStyle: 'round',
      borderColor: palette.amber,
      title: c.accent.bold('SYSTEM'),
      titleAlignment: 'left',
    }),
  );
}

export async function splash() {
  clearScreen();
  // Animated mesh-node intro around the wordmark; falls back to the static banner on a
  // non-TTY / too-narrow window (or if anything goes wrong — the splash must never hang).
  let animated = false;
  try {
    await playMeshIntro();
    animated = true;
  } catch {
    animated = false;
  }
  if (!animated) {
    console.log('\n');
    console.log(renderBanner());
  }
  console.log('');
  console.log(renderWordmark());
  console.log('\n');

  const sp = spinner('Establishing connection to the Circuit mesh…');
  const status = await checkMesh();
  await sleep(400);
  if (status.online) sp.success('Connected to the Circuit mesh');
  else sp.warn('Mesh unreachable — continuing in offline mode');

  console.log('');
  console.log(infoPanel(status));
  console.log('');
  console.log(center(c.dim(`${sym.chevron} press any key to enter the console ${sym.chevron}`)));
  return status;
}

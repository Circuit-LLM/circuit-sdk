import boxen from 'boxen';
import { config } from '../config.js';
import { c, palette, sym, brand, centerBlock } from '../ui/index.js';
import { screenFrame } from '../core/render.js';

function aboutPanel() {
  const item = (ic, k, l1, l2) =>
    [`${c.accent(ic)}  ${c.text(k.padEnd(6))} ${c.muted(l1)}`, `${' '.repeat(10)}${c.muted(l2)}`].join('\n');
  const body = [
    brand('Circuit LLM'),
    c.muted('A decentralized intelligence network.'),
    '',
    item(sym.bolt, 'DLLM', 'A 72B model served across commodity GPUs,', 'paid per-token in CIRC via x402.'),
    item(sym.circuit, 'Mesh', 'Independent nodes contribute compute and', 'earn from every inference they serve.'),
    item(sym.diamond, 'Swarm', 'Autonomous agents that trade and build', 'on top of the network.'),
    item(sym.node, 'Nodes', 'Anyone can join — one command attaches', 'a GPU to the mesh.'),
    '',
    `${c.dim('web')}   ${c.accent(config.links.web)}`,
    `${c.dim('docs')}  ${c.accent(config.links.docs)}`,
  ].join('\n');
  return centerBlock(
    boxen(body, {
      padding: { top: 1, bottom: 1, left: 3, right: 3 },
      borderStyle: 'round',
      borderColor: palette.gold,
      title: c.accent.bold('ABOUT'),
      titleAlignment: 'left',
    }),
  );
}

export default {
  id: 'about',
  icon: sym.spark,
  name: 'About',
  desc: 'About the Circuit network',
  async screen(ctx, opts = {}) {
    await screenFrame({ status: ctx.status, standalone: opts.standalone }, () => {
      console.log(aboutPanel());
    });
  },
};

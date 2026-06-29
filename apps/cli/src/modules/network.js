import {
  c, palette, sym, clearScreen, slimHeader, panel, kv, statusDot, spinner, sleep,
} from '../ui/index.js';
import { config } from '../config.js';
import { screenFrame } from '../core/render.js';
import { circuitNode } from '../services/circuitNode.js';
import { listModels } from '../services/inference.js';
import { num } from '../util/format.js';

async function gather() {
  let net = null;
  let models = null;
  let ping = null;
  try {
    net = await circuitNode.network();
  } catch {
    /* local-only; may be unreachable off-VPS */
  }
  const t0 = Date.now();
  try {
    models = await listModels();
    ping = Date.now() - t0;
  } catch {
    /* gateway unreachable */
  }
  return { net, models, ping };
}

function render({ net, models, ping }) {
  const solBody = [
    kv('Cluster', c.text('mainnet-beta')),
    kv('Validator', c.text(net?.version ? `v${net.version}` : '—')),
    kv('TPS', net?.tps != null ? c.text(num(net.tps, 0)) : c.dim('—')),
    kv('Non-vote TPS', net?.tpsNonVote != null ? c.text(num(net.tpsNonVote, 0)) : c.dim('—')),
  ].join('\n');
  console.log(panel(solBody, { title: 'SOLANA' }));
  console.log('');
  const infBody = [
    statusDot(!!models, models ? 'inference gateway online' : 'inference gateway unreachable'),
    '',
    kv('Model', c.text(models?.[0] || config.model)),
    kv('Latency', ping != null ? c.text(`${ping}ms`) : c.dim('—')),
    kv('Endpoint', c.accent('inference.circuitllm.xyz')),
    kv('Payment', c.text('CIRC · x402')),
  ].join('\n');
  console.log(panel(infBody, { title: 'DLLM MESH', color: palette.amber }));
}

async function show(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Querying the network…');
    const data = await gather();
    sp.success('Network');
    console.log('');
    render(data);
  });
}

async function watch(ctx) {
  for (;;) {
    clearScreen();
    slimHeader(ctx.status);
    console.log('');
    render(await gather());
    console.log('');
    console.log(c.dim(`  ${sym.chevron} refreshing every 4s · Ctrl-C to exit`));
    await sleep(4000);
  }
}

export default {
  id: 'network',
  icon: sym.circuit,
  name: 'Network',
  desc: 'Chain + mesh health',
  screen(ctx, opts = {}) {
    return show(ctx, opts.standalone);
  },
  register(cmd, ctx) {
    cmd.command('watch').description('live-refreshing network view').action(() => watch(ctx));
  },
};

import { c, palette, sym, panel, kv, statusDot, heading, spinner, sleep } from '../ui/index.js';
import { config, CIRC } from '../config.js';
import { screenFrame } from '../core/render.js';
import { circuitNode } from '../services/circuitNode.js';
import { priceFeed } from '../services/priceFeed.js';
import { listModels } from '../services/inference.js';
import { makeWallet } from '../services/wallet.js';
import { loadKeypair, getConnection } from '../services/solana.js';
import { money, num, tokenAmount } from '../util/format.js';

async function dashboard(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Gathering status…');
    const [models, solP, swarm, circP] = await Promise.all([
      listModels().catch(() => null),
      priceFeed.solPrice().catch(() => null),
      circuitNode.swarmStats().catch(() => null),
      priceFeed.prices([CIRC.mint]).then((p) => (p.results || p)[CIRC.mint]?.priceUsd).catch(() => null),
    ]);
    let wal = null;
    if (loadKeypair()) {
      const w = makeWallet();
      wal = {
        address: w.address,
        sol: await w.solBalance().catch(() => null),
        circ: await w.circBalance().catch(() => null),
      };
    }
    sp.success('Status');
    console.log('');

    const solUsd = solP?.priceUsd ?? solP?.price ?? null;
    console.log(
      panel(
        [
          statusDot(!!models, models ? 'mesh online' : 'mesh unreachable'),
          '',
          kv('Model', c.text(models?.[0] || config.model)),
          kv('CIRC', circP != null ? c.text(money(circP)) : c.dim('—')),
          kv('SOL', solUsd != null ? c.text(money(solUsd)) : c.dim('—')),
        ].join('\n'),
        { title: 'NETWORK' },
      ),
    );
    console.log('');
    if (swarm) {
      const a = swarm.agents || {};
      const s = swarm.signals || {};
      console.log(
        panel(
          [
            kv('Agents', c.text(`${a.total ?? '—'} total · ${a.active1h ?? 0} active`)),
            kv('Signals', c.text(`${num(s.total, 0)} · ${s.last1h ?? 0}/h`)),
          ].join('\n'),
          { title: 'SWARM', color: palette.amber },
        ),
      );
      console.log('');
    }
    const walBody = wal
      ? [
          kv('Address', c.text(wal.address.slice(0, 6) + '…' + wal.address.slice(-4))),
          kv('SOL', c.text(tokenAmount(wal.sol))),
          kv('CIRC', c.text(tokenAmount(wal.circ)) + (circP && wal.circ ? c.dim(`  (${money(wal.circ * circP)})`) : '')),
        ].join('\n')
      : c.muted('No wallet loaded. Set CIRCUIT_WALLET or ~/.circuit/id.json to chat & pay.');
    console.log(panel(walBody, { title: 'WALLET', color: wal ? palette.green : palette.dim }));
  });
}

async function doctor(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    console.log(heading('Doctor', sym.spark));
    console.log('');
    const checks = [
      ['Inference gateway', () => listModels()],
      ['circuit-node', () => circuitNode.network()],
      ['price-feed', () => priceFeed.health()],
      ['Data gateway', async () => {
        const r = await fetch(config.endpoints.data + '/health', { signal: AbortSignal.timeout(5000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
      }],
      ['Solana RPC', () => getConnection().getSlot()],
    ];
    for (const [name, fn] of checks) {
      const t0 = Date.now();
      try {
        await fn();
        console.log(`  ${statusDot(true, name)}  ${c.dim(`${Date.now() - t0}ms`)}`);
      } catch (e) {
        console.log(`  ${statusDot(false, name)}  ${c.err(e.message)}`);
      }
    }
  });
}

export default {
  id: 'status',
  icon: sym.spark,
  name: 'Status',
  desc: 'Network + wallet at a glance',
  screen(ctx, opts = {}) {
    return dashboard(ctx, opts.standalone);
  },
  register(cmd, ctx) {
    cmd.command('doctor').description('check connectivity to every service').action(() => doctor(ctx, true));
  },
};

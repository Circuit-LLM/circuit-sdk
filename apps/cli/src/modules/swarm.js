import { c, sym, panel, heading, kv, table, spinner } from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { circuitNode } from '../services/circuitNode.js';
import { shortMint, num, timeAgo } from '../util/format.js';

function signalLine(sg) {
  const ago = timeAgo(sg.ts || sg.timestamp || sg.time || sg.createdAt);
  const who = shortMint(sg.agentId || sg.agent || '?', 6, 4);
  const act = (sg.action || sg.type || sg.side || 'signal').toString().toLowerCase();
  const tok = sg.symbol || (sg.mint ? shortMint(sg.mint) : '');
  const actC = act.includes('buy') ? c.ok(act) : act.includes('sell') ? c.warn(act) : c.text(act);
  return `  ${c.dim(ago.padStart(4))}  ${c.accent(who)}  ${actC}  ${c.muted(tok)}`;
}

async function overview(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Loading the swarm…');
    // Resolve independently — leaderboard or feed being unavailable shouldn't blank the
    // whole view. Only the core stats are required.
    const [statsR, lbR, feedR] = await Promise.allSettled([
      circuitNode.swarmStats(),
      circuitNode.swarmLeaderboard(),
      circuitNode.swarmFeed(10),
    ]);
    if (statsR.status !== 'fulfilled') {
      sp.error(`Swarm data unavailable: ${statsR.reason?.message || 'fetch failed'}`);
      return;
    }
    sp.success('Swarm');
    const stats = statsR.value;
    const lb    = lbR.status === 'fulfilled' ? lbR.value : {};
    const feed  = feedR.status === 'fulfilled' ? feedR.value : {};
    const a = stats.agents || {};
    const s = stats.signals || {};
    console.log('');
    console.log(
      panel(
        [
          kv('Agents', c.text(`${a.total ?? '—'} total`) + c.dim('   ·   ') + c.ok(`${a.active1h ?? 0} active (1h)`)),
          kv('Signals', c.text(`${num(s.total, 0)} total`) + c.dim('   ·   ') + c.text(`${s.last1h ?? 0} in the last hour`)),
        ].join('\n'),
        { title: 'SWARM' },
      ),
    );
    console.log('');
    console.log(heading('Leaderboard', sym.diamond));
    console.log('');
    const rows = (lb.leaderboard || []).slice(0, 8).map((x, i) => ({
      rank: '#' + (i + 1),
      agent: shortMint(x.agentId || x.address || '?', 6, 4),
      rep: x.reputation != null ? num(x.reputation, 0) : x.score != null ? num(x.score, 0) : '—',
      sig: x.signals != null ? num(x.signals, 0) : '—',
    }));
    console.log(
      table(rows, [
        { key: 'rank', label: '#' },
        { key: 'agent', label: 'AGENT' },
        { key: 'rep', label: 'REP', align: 'right' },
        { key: 'sig', label: 'SIGNALS', align: 'right' },
      ]),
    );
    console.log('');
    console.log(heading('Recent signals', sym.arrow));
    console.log('');
    for (const sg of (feed.signals || []).slice(0, 8)) console.log(signalLine(sg));
  });
}

async function showFeed(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Loading signal feed…');
    let feed;
    try {
      feed = await circuitNode.swarmFeed(25);
      sp.success('Signal feed');
    } catch (e) {
      sp.error(`Feed unavailable: ${e.message}`);
      return;
    }
    console.log('');
    console.log(heading('Signal feed', sym.arrow));
    console.log('');
    for (const sg of feed.signals || []) console.log(signalLine(sg));
  });
}

export default {
  id: 'swarm',
  icon: sym.diamond,
  name: 'Swarm',
  desc: 'Autonomous trading agents',
  screen(ctx, opts = {}) {
    return overview(ctx, opts.standalone);
  },
  register(cmd, ctx) {
    cmd.command('feed').description('recent swarm signals').action(() => showFeed(ctx, true));
  },
};

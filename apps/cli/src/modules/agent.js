import fs from 'node:fs';
import {
  c, palette, sym, clearScreen, slimHeader, panel, kv, table, heading, badge,
  spinner, menuSelect, askText, askConfirm,
} from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { agents } from '../services/agents.js';
import { makeWallet } from '../services/wallet.js';
import * as vault from '../services/vault.js';
import { VAULT } from '../config.js';
import { pct, num, timeAgo } from '../util/format.js';

const sol = (lamports) => (Number(lamports) / 1e9).toFixed(4);
const OP_LABEL = { 1: '<', 2: '<=', 3: '>', 4: '>=' };
const OP_CODE = { lt: 1, lte: 2, gt: 3, gte: 4 };

// Load a verified-intent rule file (docs/verified-intents.md): JSON with { rule,
// acceptedKeys, acceptedNotaries?, evidenceMaxAgeMs? }. The signer re-runs `rule` on
// the authenticated inputs an agent submits before signing a trade.
function loadRuleFile(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`could not read rule file ${file}: ${e.message}`); }
  if (!j.rule || !j.rule.id) throw new Error('rule file must contain { rule: { id, when, then, requires }, acceptedKeys }');
  return {
    rule: j.rule,
    acceptedKeys: j.acceptedKeys || {},
    acceptedNotaries: j.acceptedNotaries || [],
    evidenceMaxAgeMs: j.evidenceMaxAgeMs,
  };
}

const stateColor = {
  running: c.ok, scheduled: c.warn, pending: c.warn, stopping: c.warn,
  stopped: c.dim, failed: c.err, unknown: c.dim,
};
const sc = (s) => (stateColor[s] || c.text)(s || '—');

function pnlOf(a) {
  const p = a.health?.pnlPct;
  if (p == null) return c.dim('—');
  return p >= 0 ? c.ok(pct(p)) : c.err(pct(p));
}

async function renderList(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Loading agents…');
    let list;
    try { list = await agents.list(); sp.success('Agents'); } catch (e) { sp.error(e.message); return; }
    console.log('');
    console.log(heading('Agents', sym.diamond));
    console.log('');
    if (!list.length) {
      console.log(c.muted('  No agents yet.  Create one:  ') + c.accent('circuit agent create <name>'));
    } else {
      const rows = list.map((a) => ({
        name: a.name,
        where: a.driver === 'cloud' ? a.node || c.dim('scheduling') : 'local',
        state: sc(a.state),
        pnl: pnlOf(a),
        scans: a.health?.scans != null ? num(a.health.scans, 0) : '—',
      }));
      console.log(table(rows, [
        { key: 'name', label: 'AGENT' },
        { key: 'where', label: 'WHERE' },
        { key: 'state', label: 'STATE' },
        { key: 'pnl', label: 'P&L', align: 'right' },
        { key: 'scans', label: 'SCANS', align: 'right' },
      ]));
    }
    const h = await agents.host.status();
    console.log('');
    console.log(
      h.running
        ? `  ${badge('hosting', 'ok')} ${c.muted(`contributing up to ${h.budget.maxAgents ?? '?'} agents as ${h.budget.nodeId || 'this node'}`)}${h.via === 'node-client' ? c.dim(' (via node-client)') : ''}`
        : c.dim('  not contributing capacity — `circuit agent host` to lend CPU to the cloud'),
    );
  });
}

async function showStatus(ctx, name, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner(`Reading ${name}…`);
    let s;
    let meta;
    try { meta = agents.meta(name); s = await agents.status(name); sp.success(name); } catch (e) { sp.error(e.message); return; }
    const h = s.health || {};
    const pol = s.policy;
    console.log('');
    console.log(panel([
      heading(name, sym.diamond),
      '',
      kv('Driver', c.text(meta.driver)),
      kv('Workload', c.text(meta.spec?.workload || 'agentd')),
      kv('State', sc(s.state)),
      kv('Where', c.text(s.node || (meta.driver === 'cloud' ? 'scheduling' : 'local'))),
      kv('Custody', s.custody === 'offbox-signer' ? c.text('off-box signer') + c.dim(' (key off-host)') : c.dim('local (this machine)')),
      s.address ? kv('Wallet', c.accent(s.address)) : null,
      pol ? kv('Limits', c.text(`${pol.maxNotionalSol} SOL/trade · ${pol.maxDailySol} SOL/day`) + '  ' + (pol.paper ? c.dim('paper') : c.warn('LIVE'))) : null,
      kv('P&L', pnlOf(s)),
      kv('Scans', h.scans != null ? c.text(num(h.scans, 0)) : c.dim('—')),
      h.signedTrades != null ? kv('Signed', c.text(num(h.signedTrades, 0))) : null,
      kv('Uptime', h.uptimeS != null ? c.text(`${h.uptimeS}s`) : c.dim('—')),
      kv('Updated', h.ts ? c.muted(timeAgo(h.ts) + ' ago') : c.dim('—')),
    ].filter(Boolean).join('\n'), { title: 'AGENT' }));
  });
}

async function showLogs(ctx, name, tail, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    let lines;
    try { lines = await agents.logs(name, { tail }); } catch (e) { console.log('  ' + c.err(e.message)); return; }
    console.log('');
    console.log(heading(`${name} · logs`, sym.arrow));
    console.log('');
    if (!lines.length) console.log(c.dim('  (no logs yet)'));
    for (const l of lines) console.log('  ' + c.muted(l.line));
  });
}

// ── operator: contribute capacity ──
async function hostStartFlow(maxAgents) {
  return agents.host.start({ maxAgents: Number(maxAgents) || 5, maxMemoryMb: 512 });
}

// ── non-custodial vault explainer (what it is + devnet status + Solscan link) ──
async function vaultExplainer(ctx) {
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, async () => {
    const solscan = `https://solscan.io/account/${VAULT.programId}?cluster=devnet`;
    const body = [
      heading('Non-custodial Vault', sym.diamond) + '   ' + c.warn('[ DEVNET · BETA ]'),
      '',
      c.text('Your wallet is the SOLE withdraw authority. The agent gets a trade-only delegate key'),
      c.text('that can ONLY swap within the on-chain guard (buy/sell, your caps, allowed routes) —'),
      c.text('it can never withdraw. Circuit holds no keys.'),
      '',
      c.muted('vs. the custodial signer (default): that one is fine for paper / bootstrap, but it'),
      c.muted('holds the agent\'s key off-box — you trust the operator. The vault removes that trust.'),
      '',
      kv('Status', c.warn('live on devnet — unaudited beta; fund small amounts')),
      kv('Program', c.accent(VAULT.programId)),
      kv('Explorer', c.dim(solscan)),
      '',
      c.muted('Commands:'),
      c.dim('  circuit agent vault create <name> --max-trade <sol> --max-daily <sol>'),
      c.dim('  circuit agent vault fund <name> <sol>      circuit agent vault status <name>'),
      c.dim('  circuit agent vault withdraw <name> <sol>  (owner only)'),
    ].join('\n');
    console.log(panel(body, { title: 'VAULT', color: palette.gold }));
  });
}

// ── Deploy to Mesh — publish a local agent folder as a signed bundle and run it on the cloud ──
// The folder's code is packed into a content-addressed, signed tarball (secrets auto-excluded, see
// services/bundle.js) and pulled onto an untrusted node, which verifies the sha256 + your signature
// before running it. Custody stays off-box (the agent gets a session token, never a key); secrets
// never ship — the agent authenticates to Circuit via that session, and app config goes through --env.
async function deployFlow(ctx) {
  if (!makeWallet().address) {
    await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => {
      console.log('  ' + c.warn('Connect a wallet first — the publisher signs the bundle and becomes its owner.'));
      console.log('  ' + c.dim('Wallet → Connect a wallet, then come back.'));
    });
    return;
  }
  const dir = await askText('Path to your agent folder', { placeholder: './my-agent' });
  if (!dir) return;
  const entry = (await askText('Entry file', { defaultValue: 'agent.js', placeholder: 'agent.js' })) || 'agent.js';
  const name = await askText('Name it', { placeholder: 'alpha' });
  if (!name) return;

  await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
    const path = await import('node:path');
    const { publishDir } = await import('../services/bundle.js');
    const sp = spinner('Packing + signing bundle…');
    let bundle;
    try {
      bundle = publishDir({ dir: path.resolve(dir.trim()), agentId: name.trim(), entry: entry.trim() });
      sp.success(`Bundled ${bundle.fileCount} file${bundle.fileCount === 1 ? '' : 's'} → ${bundle.sha256.slice(0, 12)}…`);
    } catch (e) {
      sp.error(e.message);
      return;
    }
    if (bundle.excludedSecrets?.length) {
      console.log('');
      console.log('  ' + c.warn(`${sym.bolt} kept OUT of the bundle`) + c.dim(' (secrets never ship to a host):'));
      for (const s of bundle.excludedSecrets.slice(0, 8)) console.log('    ' + c.muted(s));
      console.log('  ' + c.dim('The agent authenticates to Circuit via its session token — it needs no keys on the node.'));
    }
    console.log('');
    const sp2 = spinner('Deploying to the mesh…');
    try {
      const owner = makeWallet().address; // funds can only ever be withdrawn back here
      const m = await agents.create(name.trim(), { driver: 'cloud', config: { paperTrading: true }, owner, bundle });
      await agents.start(name.trim());
      sp2.success(`Deployed "${name.trim()}"${m.id ? ` · ${m.id}` : ''}`);
      console.log('  ' + c.muted('bundle  ') + c.text(`${bundle.sha256.slice(0, 16)}…`) + c.dim('   (verified on the node before it runs)'));
      console.log('  ' + c.muted('custody ') + c.text('off-box signer') + c.dim(' — the signing key never touches the host'));
      if (m.address) {
        console.log('  ' + c.muted('wallet  ') + c.accent(m.address) + c.dim('   (fund this — paper by default)'));
        console.log('  ' + c.muted('owner   ') + c.text(owner) + c.dim('   (you can always withdraw)'));
      }
    } catch (e) {
      sp2.error(e.message);
    }
  });
}

export default {
  id: 'agent',
  icon: sym.diamond,
  name: 'Agents',
  desc: 'Launch & host autonomous agents',

  async screen(ctx, opts = {}) {
    if (opts.standalone) return renderList(ctx, true);
    for (;;) {
      clearScreen();
      slimHeader(ctx.status);
      const choice = await menuSelect(c.text('Agents'), [
        { value: 'list', label: `${sym.diamond}  View agents`, hint: 'all agents · status + P&L' },
        { value: 'status', label: `${sym.diamond}  Agent details`, hint: 'one agent · custody, wallet, P&L' },
        { value: 'logs', label: `${sym.arrow}  View logs`, hint: 'recent agent output' },
        { value: 'create', label: `${sym.spark}  Create an agent`, hint: 'local or cloud' },
        { value: 'deploy', label: `${sym.node}  Deploy to Mesh`, hint: 'publish a local folder to the cloud' },
        { value: 'start', label: `${sym.arrow}  Start an agent` },
        { value: 'stop', label: `${sym.cross}  Stop an agent` },
        { value: 'command', label: `${sym.arrow}  Send a command`, hint: 'change a running agent, live' },
        { value: 'action', label: `${sym.spark}  Run an action`, hint: 'one-shot command on a running agent' },
        { value: 'withdraw', label: `${sym.spark}  Withdraw funds`, hint: 'pull the agent wallet back to you' },
        { value: 'destroy', label: `${sym.cross}  Delete an agent`, hint: 'stop + remove its record' },
        { value: 'host', label: `${sym.node}  Contribute capacity`, hint: 'lend CPU to the cloud' },
        { value: 'vault', label: `${sym.diamond}  Vault (non-custodial)`, hint: 'devnet · beta' },
        { value: 'back', label: `${sym.chevron}  Back` },
      ]);
      if (choice === 'back') return;
      if (choice === 'vault') { await vaultExplainer(ctx); continue; }
      if (choice === 'deploy') { await deployFlow(ctx); continue; }
      if (choice === 'status' || choice === 'logs') {
        const list = await agents.list();
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text('Which agent?'), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        if (choice === 'status') await showStatus(ctx, pick, false);
        else await showLogs(ctx, pick, 25, false);
        continue;
      }
      if (choice === 'withdraw') {
        const list = await agents.list();
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text('Withdraw from which agent?'), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        const amtStr = ((await askText('Amount in SOL (blank = all)', { placeholder: 'all' })) || '').trim();
        let amount;
        if (amtStr) { amount = parseFloat(amtStr); if (!(amount > 0)) continue; }
        if (!(await askConfirm(`Withdraw ${amount ? amount + ' SOL' : 'ALL SOL'} from "${pick}" back to your owner wallet?`, { initialValue: false }))) continue;
        await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
          const sp = spinner('Withdrawing…');
          try {
            const r = await agents.withdraw(pick, amount);
            sp.success(`Withdrew ${(Number(r.lamports) / 1e9).toFixed(6)} SOL → ${r.owner}`);
            console.log('  ' + c.dim('tx ') + c.accent(r.signature));
          } catch (e) { sp.error(e.message); }
        });
        continue;
      }
      if (choice === 'list') await renderList(ctx);
      else if (choice === 'create') {
        const name = await askText('Agent name', { placeholder: 'e.g. alpha' });
        if (!name) continue;
        const where = await menuSelect(c.text('Run it where?'), [
          { value: 'local', label: 'Local (this machine)' },
          { value: 'cloud', label: 'Cloud (the Circuit mesh)' },
        ]);
        await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
          const sp = spinner('Creating…');
          try {
            await agents.create(name.trim(), { driver: where, config: { scanIntervalMs: 5000, paperTrading: true } });
            await agents.start(name.trim());
            sp.success(`Created + started "${name.trim()}" (${where})`);
          } catch (e) { sp.error(e.message); }
        });
      } else if (choice === 'start' || choice === 'stop') {
        const list = await agents.list();
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text(`${choice} which agent?`), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
          const sp = spinner(`${choice}…`);
          try { await agents[choice](pick); sp.success(`${pick} ${choice === 'start' ? 'started' : 'stopped'}`); } catch (e) { sp.error(e.message); }
        });
      } else if (choice === 'command') {
        const list = (await agents.list()).filter((a) => a.driver === 'cloud');
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text('Command which agent?'), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        const kv = await askText('Config change (key=value)', { placeholder: 'e.g. topN=8  ·  paused=true' });
        if (!kv || !kv.includes('=')) continue;
        const [k, ...rest] = kv.split('=');
        const raw = rest.join('=').trim();
        const value = raw === 'true' ? true : raw === 'false' ? false : Number.isFinite(Number(raw)) && raw !== '' ? Number(raw) : raw;
        const patch = { [k.trim()]: value };
        await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
          const sp = spinner('Signing + sending…');
          try {
            const r = await agents.command(pick, patch);
            sp.success(`Command queued (seq ${r.seq}) — the agent applies it on its next tick`);
            const st = await agents.commandStatus(pick).catch(() => null);
            if (st) console.log('  ' + c.dim(`applied through seq ${st.ackedSeq} · ${st.pending.length} pending`));
          } catch (e) { sp.error(e.message); }
        });
      } else if (choice === 'action') {
        const list = (await agents.list()).filter((a) => a.driver === 'cloud');
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text('Run an action on which agent?'), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        const name = await askText('Action name', { placeholder: 'e.g. scanNow' });
        if (!name || !name.trim()) continue;
        await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
          const sp = spinner('Signing + sending…');
          try {
            const r = await agents.action(pick, name.trim());
            sp.success(`Action "${r.action}" queued (seq ${r.seq}) — runs once on the next tick`);
          } catch (e) { sp.error(e.message); }
        });
      } else if (choice === 'destroy') {
        const list = await agents.list();
        if (!list.length) { await renderList(ctx); continue; }
        const pick = await menuSelect(c.text('Delete which agent?'), list.map((a) => ({ value: a.name, label: `${a.name}  ${c.dim(a.state)}` })));
        if (!(await askConfirm(`Delete "${pick}"? Stops it and removes its record.`, { initialValue: false }))) continue;
        let force = false, retry = true;
        while (retry) {
          retry = false;
          let fundsErr = false;
          await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
            const sp = spinner('Deleting…');
            try { await agents.destroy(pick, { force }); sp.success(`Deleted ${pick}`); }
            catch (e) { sp.error(e.message); fundsErr = !force && /not-empty|still holds|funds/.test(e.message); }
          });
          if (fundsErr && (await askConfirm(`"${pick}" still holds funds — force-delete and ABANDON them? (irreversible)`, { initialValue: false }))) { force = true; retry = true; }
        }
      } else if (choice === 'host') {
        const st = await agents.host.status();
        if (st.running) {
          const off = await askConfirm(`Hosting is on (${st.budget.maxAgents ?? '?'} agents). Stop contributing?`, { initialValue: false });
          if (off) await agents.host.stop();
        } else {
          const n = await askText('Max agents to host', { placeholder: '5', defaultValue: '5' });
          await screenFrame({ status: ctx.status, footer: 'press any key to continue' }, async () => {
            try { const r = await hostStartFlow(n); console.log('  ' + c.ok(sym.check) + c.text(` contributing up to ${r.budget.maxAgents ?? '?'} agents`) + (r.via === 'node-client' ? c.dim(' (via node-client)') : '')); }
            catch (e) { console.log('  ' + c.err(e.message)); }
          });
        }
      }
    }
  },

  register(cmd, ctx) {
    cmd
      .command('create <name>')
      .description('create an agent (default local; --cloud to host on the mesh)')
      .option('--cloud', 'run on the Circuit cloud')
      .option('--workload <w>', 'agentd | circuit-agent', 'agentd')
      .option('--bundle <dir>', 'publish a local agent directory as a content-addressed bundle and run it on the mesh (B1)')
      .option('--entry <file>', 'bundle entry file', 'agent.js')
      .option('--interval <ms>', 'scan interval', (v) => parseInt(v, 10))
      .option('--strategy <s>', 'strategy label', 'dip-reversal')
      .option('--max-trade <sol>', 'custody: max SOL per trade', parseFloat, 0.05)
      .option('--max-daily <sol>', 'custody: max SOL per day', parseFloat, 0.5)
      .option('--cooldown <ms>', 'custody: min ms between trades', (v) => parseInt(v, 10), 30000)
      .option('--rule <file>', 'verified-intent rule file (JSON) — signer re-derives every trade')
      .option('--require-verified', 'reject any trade the rule + authenticated inputs don\'t justify')
      .option('--owner <addr>', 'withdraw address funds can be pulled back to (default: your wallet)')
      .option('--live', 'trade real funds (default: paper)')
      .action(async (name, o) => {
        const sp = spinner('Creating agent…');
        try {
          let verified;
          if (o.rule) {
            verified = loadRuleFile(o.rule);
            if (!o.cloud) sp.warn?.('--rule binds at the off-box signer; it has full effect with --cloud');
          }
          // B1: publish the agent directory as a content-addressed, signed bundle. Bundles run on the
          // mesh node-host, so this implies --cloud. The publisher (your wallet) becomes the owner.
          let bundle;
          if (o.bundle) {
            const { publishDir } = await import('../services/bundle.js');
            const path = await import('node:path');
            bundle = publishDir({ dir: path.resolve(o.bundle), agentId: name, entry: o.entry });
            o.cloud = true;
            sp.message?.(`Published bundle ${bundle.sha256.slice(0, 12)}…`);
          }
          // Owner = the wallet funds can be withdrawn back to. Default to your own wallet so an
          // agent is never a one-way deposit — you can always pull your SOL home.
          const owner = o.owner || (o.cloud ? makeWallet().address : undefined) || undefined;
          const policy = o.cloud
            ? { maxNotionalSol: o.maxTrade, maxDailySol: o.maxDaily, cooldownMs: o.cooldown, paper: !o.live,
                ...(o.requireVerified ? { requireVerifiedIntent: true } : {}) }
            : undefined;
          const m = await agents.create(name, {
            driver: o.cloud ? 'cloud' : 'local',
            workload: o.workload,
            config: { scanIntervalMs: o.interval || 5000, strategy: o.strategy, paperTrading: !o.live, tradeSizeSol: Math.min(0.01, o.maxTrade) },
            policy,
            verified,
            owner,
            bundle,
          });
          sp.success(`Created "${name}" (${m.driver}${m.id ? ' · ' + m.id : ''})`);
          if (bundle) console.log('  ' + c.muted('bundle  ') + c.text(bundle.sha256.slice(0, 16) + '…') + c.dim(`   (${bundle.fileCount} files · verified on the node before it runs)`));
          if (bundle?.excludedSecrets?.length) console.log('  ' + c.warn(`${sym.bolt} kept out`) + c.dim('  ') + c.muted(bundle.excludedSecrets.slice(0, 6).join(', ')) + c.dim('  (secrets never ship — agent uses its session token)'));
          if (m.address) {
            console.log('  ' + c.muted('custody ') + c.text('off-box signer') + c.dim(' — the signing key never touches the host'));
            console.log('  ' + c.muted('wallet  ') + c.accent(m.address) + c.dim('   (fund this)'));
            console.log('  ' + c.muted('owner   ') + (owner ? c.text(owner) + c.dim('   (withdraw back here)') : c.warn('none — set one before funding:  circuit agent owner ' + name + ' <addr>')));
            if (verified) console.log('  ' + c.muted('rule    ') + c.text(verified.rule.id) + c.dim(o.requireVerified ? '   (required — forged trades rejected)' : '   (advisory)'));
            console.log('  ' + c.dim(`fund it, then:  circuit agent start ${name}`) + (o.live ? c.warn('   LIVE — real funds') : c.dim('   (paper)')));
          } else {
            console.log(c.dim(`  start it:  circuit agent start ${name}`));
          }
        } catch (e) { sp.error(e.message); }
      });

    cmd.command('start <name>').description('start an agent').action(async (name) => {
      const sp = spinner(`Starting ${name}…`);
      try { const r = await agents.start(name); sp.success(`Started ${name}`); console.log(c.dim(`  ${r.node ? 'scheduling on the mesh' : 'pid ' + r.pid}`)); } catch (e) { sp.error(e.message); }
    });
    cmd.command('stop <name>').description('stop an agent').action(async (name) => {
      const sp = spinner(`Stopping ${name}…`);
      try { await agents.stop(name); sp.success(`Stopped ${name}`); } catch (e) { sp.error(e.message); }
    });
    cmd.command('destroy <name>').description('stop and delete an agent (refuses if the wallet still holds funds)').option('-y, --yes', 'skip confirmation').option('--force', 'destroy even if funds remain (abandons them — irreversible)').action(async (name, o) => {
      if (!o.yes) {
        if (!process.stdin.isTTY) { console.log(c.warn('  refusing to destroy without --yes (non-interactive)')); return; }
        const ok = await askConfirm(`Destroy "${name}"? This stops it and deletes its record.`, { initialValue: false });
        if (!ok) return;
      }
      const sp = spinner(`Destroying ${name}…`);
      try { await agents.destroy(name, { force: !!o.force }); sp.success(`Destroyed ${name}`); }
      catch (e) {
        sp.error(e.message);
        if (/not-empty|still holds/.test(e.message)) console.log(c.dim(`  withdraw first:  circuit agent withdraw ${name}   ·   or abandon:  circuit agent destroy ${name} --force`));
      }
    });

    // ── owner-recovery: get your funds (or your key) back out ──
    cmd.command('owner <name> <address>').description('set the withdraw address funds can be pulled back to').action(async (name, address) => {
      const sp = spinner('Setting owner…');
      try { await agents.setOwner(name, address); sp.success(`Owner set → ${address}`); } catch (e) { sp.error(e.message); }
    });
    cmd.command('withdraw <name>').description('withdraw the agent wallet’s SOL back to its owner address').option('--amount <sol>', 'SOL to withdraw (default: all)', parseFloat).action(async (name, o) => {
      const sp = spinner('Withdrawing…');
      try {
        const r = await agents.withdraw(name, o.amount);
        sp.success(`Withdrew ${(Number(r.lamports) / 1e9).toFixed(6)} SOL → ${r.owner}`);
        console.log('  ' + c.dim('tx ') + c.accent(r.signature));
      } catch (e) { sp.error(e.message); }
    });
    cmd.command('export <name>').description('export the agent wallet’s PRIVATE KEY (take full custody)').option('-y, --yes', 'skip confirmation').action(async (name, o) => {
      console.log(c.warn(`  ${sym.bolt}  This reveals the wallet’s private key. After export the off-box "can’t be stolen" property`));
      console.log(c.warn('     no longer holds for this wallet — store it like any hot-wallet key. Stop the agent first.'));
      if (!o.yes) {
        if (!process.stdin.isTTY) { console.log(c.warn('  refusing to export without --yes (non-interactive)')); return; }
        if (!(await askConfirm(`Reveal the private key for "${name}"?`, { initialValue: false }))) return;
      }
      const sp = spinner('Exporting…');
      try {
        const r = await agents.exportKey(name);
        sp.success('Exported — import this into any Solana wallet');
        console.log('  ' + c.muted('address ') + c.accent(r.address));
        console.log('  ' + c.muted('secret  ') + c.text(r.secretKeyBase58));
      } catch (e) { sp.error(e.message); }
    });
    cmd.command('list').description('list agents').action(() => renderList(ctx, true));
    cmd.command('status <name>').description('agent status + P&L').action((name) => showStatus(ctx, name, true));
    cmd
      .command('verify <name>')
      .description('show the verified-intent contract (committed rule + trusted producer keys)')
      .action(async (name) => {
        const sp = spinner('Fetching…');
        try {
          const s = await agents.status(name);
          sp.stop?.();
          const v = s.verified;
          if (!v || !v.rule) {
            console.log(c.dim('  no committed rule — trades rely on policy caps + deterrence (see docs/verified-intents.md).'));
            console.log(c.dim('  add one at create:  circuit agent create <name> --cloud --rule rule.json --require-verified'));
            return;
          }
          const cond = (v.rule.when || []).map((w) => `${w.input} ${w.op} ${w.value}`).join('  AND  ') || '—';
          const then = `${v.rule.then?.kind ?? '?'} ${v.rule.then?.token ?? v.rule.then?.tokenInput ?? ''}`.trim();
          console.log('  ' + c.muted('rule       ') + c.text(v.rule.id));
          console.log('  ' + c.muted('enforced   ') + (s.policy?.requireVerifiedIntent ? c.ok('yes — the signer rejects any trade this rule doesn\'t justify') : c.warn('advisory (set --require-verified to enforce)')));
          console.log('  ' + c.muted('when       ') + c.text(cond));
          console.log('  ' + c.muted('then       ') + c.text(then));
          console.log('  ' + c.muted('requires   ') + c.text((v.rule.requires || []).join(', ') || '—') + c.dim('  (inputs that must be backed by evidence)'));
          console.log('  ' + c.muted('trusts     ') + c.text(`${Object.keys(v.acceptedKeys || {}).length} producer key(s)`) + (v.acceptedNotaries?.length ? c.text(` + ${v.acceptedNotaries.length} notary`) : ''));
        } catch (e) { sp.error(e.message); }
      });
    cmd.command('logs <name>').description('recent agent logs').option('--tail <n>', 'lines', (v) => parseInt(v, 10), 25).action((name, o) => showLogs(ctx, name, o.tail, true));

    cmd
      .command('host')
      .description('contribute CPU capacity to the agent cloud (operator)')
      .option('--max-agents <n>', 'max agents to host', (v) => parseInt(v, 10), 5)
      .option('--node-id <id>', 'node identifier')
      .option('--max-memory <mb>', 'per-agent memory cap', (v) => parseInt(v, 10), 512)
      .option('--status', 'show hosting status')
      .option('--off', 'stop contributing')
      .action(async (o) => {
        const where = (s) => (s.via === 'node-client' ? ' · via node-client' : s.pid ? ' · pid ' + s.pid : '');
        if (o.off) { await agents.host.stop(); console.log(c.muted('  stopped contributing.')); return; }
        const st = await agents.host.status();
        if (o.status) {
          console.log(st.running ? `  ${c.ok(sym.dot)} hosting · ${st.budget.maxAgents ?? '?'} agents${where(st)}` : c.dim('  not contributing'));
          return;
        }
        if (st.running) { console.log(c.muted(`  already hosting (${st.budget.maxAgents ?? '?'} agents). --off to stop.`)); return; }
        try {
          const r = await agents.host.start({ maxAgents: o.maxAgents, nodeId: o.nodeId, maxMemoryMb: o.maxMemory });
          console.log(`  ${c.ok(sym.check)} contributing up to ${c.text(r.budget.maxAgents ?? '?')} agents to the cloud  ${c.dim('(' + (r.via === 'node-client' ? 'via node-client' : 'pid ' + r.pid) + ')')}`);
        } catch (e) { console.log('  ' + c.err(e.message)); }
      });

    // ── non-custodial on-chain custody (Agent Vault) ──
    // The owner (this wallet) is the sole withdraw authority; the vault's delegate key can only trade
    // through the on-chain guard. Circuit holds no keys. See circuit-agent-vault.
    const v = cmd.command('vault').description('non-custodial on-chain custody (owner-controlled vault)');

    v.command('create <name>')
      .description('create a vault (this wallet = owner/withdraw authority; generates the trade-only delegate)')
      .option('--max-trade <sol>', 'cap per trade', parseFloat, 0.05)
      .option('--max-daily <sol>', 'rolling 24h cap', parseFloat, 0.5)
      .option('--rpc <url>', 'cluster RPC (defaults to your configured RPC)')
      .action(async (name, o) => {
        const sp = spinner('Creating vault…');
        try {
          const r = await vault.create(name, { maxTradeSol: o.maxTrade, maxDailySol: o.maxDaily, rpc: o.rpc });
          sp.success(`Vault "${name}" created`);
          console.log('  ' + c.muted('vault    ') + c.accent(r.vault));
          console.log('  ' + c.muted('delegate ') + c.text(r.delegate) + c.dim('  (trade-only — can never withdraw)'));
          console.log('  ' + c.dim(`fund it:  circuit agent vault fund ${name} <sol>`));
          console.log('  ' + c.warn('beta') + c.dim(' — the vault program is unaudited; fund small amounts until you\'re comfortable'));
          console.log('  ' + c.warn('floor') + c.dim(' — custody is enforced on-chain, but a compromised host can still trade at a BAD RATE.'));
          console.log('  ' + c.dim(`          For an UNTRUSTED host, set an execution floor:  circuit agent vault rule ${name} \\`));
          console.log('  ' + c.dim('            --oracle <pk> --feed <hex> --op gte --threshold <rate> --max-age 60 --in-mint <m> --out-mint <m> --max-slippage 100'));
        } catch (e) { sp.error(e.message); }
      });

    v.command('list').description('list your vaults').action(() => {
      const names = vault.listVaults();
      if (!names.length) { console.log(c.muted('  No vaults yet.  Create one:  ') + c.accent('circuit agent vault create <name>')); return; }
      console.log('');
      for (const n of names) { const m = vault.readMeta(n); console.log('  ' + c.text(n.padEnd(16)) + c.dim(m.vault)); }
    });

    v.command('status <name>').description('vault state (caps, delegate, rule, routes)').option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => {
        const sp = spinner(`Reading ${name}…`);
        try {
          const s = await vault.fetch(name, { rpc: o.rpc });
          sp.stop?.();
          if (!s.exists) { console.log(c.warn(`  vault "${name}" not found on-chain (not deployed yet?)`)); console.log('  ' + c.dim('vault ') + c.accent(s.vault)); return; }
          console.log('');
          console.log(panel([
            heading(name, sym.diamond), '',
            kv('Vault', c.accent(s.vault)),
            kv('Owner', c.text(s.owner)),
            kv('Delegate', c.text(s.delegate) + c.dim(' (trade-only)')),
            kv('Balance', c.text(sol(s.lamports) + ' SOL')),
            kv('Caps', c.text(`${sol(s.maxTradeLamports)} /trade · ${sol(s.dailyLimitLamports)} /day`) + (s.paused ? '  ' + c.warn('PAUSED') : '')),
            kv('Spent 24h', c.text(sol(s.daySpentLamports) + ' SOL')),
            kv('Routes', s.routes.length ? c.text(s.routes.join(', ')) : c.dim('any (guard-only)')),
            kv('Rule', s.rule ? c.text(`price ${OP_LABEL[s.rule.op] || '?'} ${s.rule.threshold}  ·  ≤${s.rule.maxAge}s`) + c.dim(`  oracle ${s.rule.oracle.slice(0, 8)}…`) : c.dim('none')),
            kv('Epoch', c.text(String(s.epoch))),
          ].filter(Boolean).join('\n'), { title: 'VAULT' }));
        } catch (e) { sp.error(e.message); }
      });

    v.command('fund <name> <sol>').description('deposit SOL into the vault').option('--rpc <url>', 'cluster RPC')
      .action(async (name, amount, o) => {
        const sp = spinner('Funding…');
        try { const sig = await vault.fund(name, parseFloat(amount), { rpc: o.rpc }); sp.success(`Funded ${amount} SOL`); console.log('  ' + c.dim('tx ') + c.accent(sig)); }
        catch (e) { sp.error(e.message); }
      });

    v.command('withdraw <name> <sol>').description('withdraw SOL back to the owner (the escape hatch)').option('--rpc <url>', 'cluster RPC')
      .action(async (name, amount, o) => {
        const sp = spinner('Withdrawing…');
        try { const sig = await vault.withdraw(name, parseFloat(amount), { rpc: o.rpc }); sp.success(`Withdrew ${amount} SOL → owner`); console.log('  ' + c.dim('tx ') + c.accent(sig)); }
        catch (e) { sp.error(e.message); }
      });

    v.command('pause <name>').description('halt trading (withdraw still works)').option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => { const sp = spinner('Pausing…'); try { await vault.configure(name, { paused: true, rpc: o.rpc }); sp.success(`${name} paused`); } catch (e) { sp.error(e.message); } });
    v.command('unpause <name>').description('resume trading').option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => { const sp = spinner('Resuming…'); try { await vault.configure(name, { paused: false, rpc: o.rpc }); sp.success(`${name} resumed`); } catch (e) { sp.error(e.message); } });

    v.command('rotate <name>').description('rotate the agent delegate key (fences out the old one)').option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => { const sp = spinner('Rotating delegate…'); try { const r = await vault.rotateDelegate(name, { rpc: o.rpc }); sp.success('Delegate rotated'); console.log('  ' + c.muted('delegate ') + c.text(r.delegate)); } catch (e) { sp.error(e.message); } });

    v.command('routes <name> [programs...]').description('restrict trading to router program ids (none = clear → any)').option('--rpc <url>', 'cluster RPC')
      .action(async (name, programs, o) => { const sp = spinner('Setting routes…'); try { await vault.setRoutes(name, programs || [], { rpc: o.rpc }); sp.success((programs && programs.length) ? `Restricted to ${programs.length} route(s)` : 'Cleared — any router allowed'); } catch (e) { sp.error(e.message); } });

    v.command('rule <name>').description('commit a Verified-Intents price rule (or --clear)')
      .option('--clear', 'remove the rule')
      .option('--oracle <pk>', 'price signer pubkey')
      .option('--feed <hex>', '32-byte feed id (hex)')
      .option('--op <op>', 'lt | lte | gt | gte')
      .option('--threshold <n>', 'price threshold', parseFloat)
      .option('--max-age <s>', 'max attestation age (secs)', (x) => parseInt(x, 10))
      .option('--in-mint <pk>', 'pin input mint (direction)')
      .option('--out-mint <pk>', 'pin output mint (direction)')
      .option('--max-slippage <bps>', 'execution floor: reject min_out below the attested rate by > this (bps; 0 = off)', (x) => parseInt(x, 10))
      .option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => {
        const sp = spinner('Setting rule…');
        try {
          if (o.clear) { await vault.setRule(name, { op: 0, feed: Buffer.alloc(32) }, { rpc: o.rpc }); sp.success('Rule cleared'); return; }
          const op = OP_CODE[o.op];
          if (!op) throw new Error('--op must be one of lt | lte | gt | gte (or use --clear)');
          if (!o.oracle || !o.feed || o.threshold == null || o.maxAge == null) throw new Error('rule needs --oracle --feed --op --threshold --max-age');
          const feed = Buffer.from(o.feed.replace(/^0x/, ''), 'hex');
          await vault.setRule(name, { oracle: o.oracle, feed, op, threshold: o.threshold, maxAge: o.maxAge, inMint: o.inMint, outMint: o.outMint, maxSlippageBps: o.maxSlippage }, { rpc: o.rpc });
          sp.success(`Rule set: price ${o.op} ${o.threshold} (≤${o.maxAge}s)` + (o.maxSlippage ? `, floor ${o.maxSlippage}bps` : ''));
        } catch (e) { sp.error(e.message); }
      });

    v.command('close <name>').description('close the vault, returning rent to the owner').option('-y, --yes', 'skip confirmation').option('--rpc <url>', 'cluster RPC')
      .action(async (name, o) => {
        if (!o.yes) {
          if (!process.stdin.isTTY) { console.log(c.warn('  refusing to close without --yes (non-interactive)')); return; }
          if (!(await askConfirm(`Close vault "${name}"? Withdraw funds first.`, { initialValue: false }))) return;
        }
        const sp = spinner('Closing…');
        try { const sig = await vault.close(name, { rpc: o.rpc }); sp.success(`Closed ${name}`); console.log('  ' + c.dim('tx ') + c.accent(sig)); }
        catch (e) { sp.error(e.message); }
      });
  },
};

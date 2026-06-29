import {
  c, palette, sym, clearScreen, slimHeader, panel, heading, kv, brailleChart,
  spinner, menuSelect, askText, cols,
} from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { priceFeed } from '../services/priceFeed.js';
import { money, pct, shortMint } from '../util/format.js';

const WSOL = 'So11111111111111111111111111111111111111112';

// ── compact formatters for the enriched token cards ──
function compactUsd(n) {
  if (n == null || !isFinite(n)) return c.dim('—');
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
function fmtPrice(n) {
  if (n == null || !isFinite(n)) return c.dim('—');
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.0001) return `$${n.toFixed(6)}`;
  return `$${n.toPrecision(3)}`; // sub-0.0001 memecoin prices
}
function fmtChg(v) {
  if (v == null || !isFinite(v)) return c.dim('  —');
  const s = `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  return v >= 0 ? c.ok(s) : c.err(s);
}
// One token rendered as a 3-line card: symbol · name + price/mc/liq, the 5m/1h/6h/24h row, full mint.
function tokenCard(card, { change1h } = {}) {
  const symbol = card?.symbol || shortMint(card?.mint || '', 4, 4);
  const name = card?.name && card.name !== card?.symbol ? c.muted(` · ${card.name}`) : '';
  const ch = card?.change || {};
  return [
    `  ${c.accent(sym.dot)}  ${c.text(symbol)}${name}   ${c.bold(fmtPrice(card?.priceUsd))}`
      + `   ${c.dim('mc')} ${compactUsd(card?.marketCap)}   ${c.dim('liq')} ${compactUsd(card?.liquidity)}`,
    `     ${c.dim('5m')} ${fmtChg(ch.m5)}   ${c.dim('1h')} ${fmtChg(ch.h1 ?? change1h)}   ${c.dim('6h')} ${fmtChg(ch.h6)}   ${c.dim('24h')} ${fmtChg(ch.h24)}`,
    `     ${c.muted(card?.mint || '')}`,
  ].join('\n');
}

// Fetch DexScreener cards for a list of mints; never throws (cards are best-effort enrichment).
async function cardsFor(mints) {
  try {
    return (await priceFeed.cards(mints)).cards || {};
  } catch {
    return {};
  }
}

async function showTrending(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Loading trending tokens…');
    let tokens;
    try {
      tokens = ((await priceFeed.trending(12)).tokens || []).filter((t) => t.mint !== WSOL);
      sp.success('Trending');
    } catch (e) {
      sp.error(`Trending unavailable: ${e.message}`);
      return;
    }
    if (!tokens.length) {
      console.log(`\n  ${c.muted('No trending tokens right now.')}`);
      return;
    }
    const top = tokens.slice(0, 10);
    const cards = await cardsFor(top.map((t) => t.mint));
    console.log('');
    console.log(heading('Trending', sym.diamond));
    console.log('');
    for (const t of top) {
      console.log(tokenCard(cards[t.mint] || { mint: t.mint, priceUsd: t.priceUsd }));
      console.log('');
    }
  });
}

async function showDips(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Scanning for dips…');
    let losers;
    try {
      losers = (await priceFeed.losers(20)).losers || [];
      sp.success('Dip scanner (1h)');
    } catch (e) {
      sp.error(`Dip feed unavailable: ${e.message}`);
      return;
    }
    if (!losers.length) {
      console.log(`\n  ${c.dim('No dippers right now — the market is flat or rising.')}`);
      return;
    }
    const top = losers.slice(0, 10);
    const cards = await cardsFor(top.map((l) => l.mint));
    console.log('');
    console.log(heading('Dipping now (1h)', sym.arrow));
    console.log('');
    for (const l of top) {
      console.log(tokenCard(cards[l.mint] || { mint: l.mint }, { change1h: l.change1h }));
      console.log('');
    }
  });
}

async function showToken(ctx, mint, standalone) {
  mint = String(mint || '').trim();
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner(`Fetching ${shortMint(mint)}…`);
    let pr;
    let candles = [];
    try {
      const p = await priceFeed.prices([mint]);
      pr = (p.results || p)[mint];
      const cd = await priceFeed.candles(mint, '1h', 48).catch(() => ({ candles: [] }));
      candles = cd.candles || [];
      sp.success('Loaded');
    } catch (e) {
      sp.error(`Lookup failed: ${e.message}`);
      return;
    }
    if (!pr || !(pr.priceUsd > 0)) {
      console.log(`\n  ${c.warn('No price data for that mint (not indexed, or not a SOL/CIRC-paired token).')}`);
      return;
    }
    const liq = pr.solReserve && pr.solUsd ? pr.solReserve * pr.solUsd * 2 : null;
    const closes = candles.map((k) => k.c).filter((v) => isFinite(v));
    const chg = closes.length > 1 ? ((closes.at(-1) - closes[0]) / closes[0]) * 100 : null;
    const chgC = chg == null ? c.dim('—') : chg >= 0 ? c.ok(pct(chg)) : c.err(pct(chg));
    console.log('');
    const body = [
      heading(shortMint(mint, 6, 6), sym.stack),
      '',
      kv('Price', c.text(money(pr.priceUsd))),
      kv('Liquidity', liq != null ? c.text(money(liq)) : c.dim('—')),
      kv('Change', chgC + c.dim('  (last 48h)')),
      kv('Source', c.muted(pr.source || '—')),
    ].join('\n');
    console.log(panel(body, { title: 'TOKEN' }));
    if (closes.length > 2) {
      console.log('');
      console.log(c.dim(`  1h candles · last ${closes.length}`));
      for (const line of brailleChart(closes, { width: Math.min(64, cols() - 12), height: 10 })) {
        console.log('  ' + line);
      }
    }
  });
}

export default {
  id: 'data',
  icon: sym.stack,
  name: 'Data',
  desc: 'On-chain market data',
  async screen(ctx, opts = {}) {
    if (opts.standalone) return showTrending(ctx, true);
    for (;;) {
      clearScreen();
      slimHeader(ctx.status);
      const choice = await menuSelect(c.text('Data — pick a view'), [
        { value: 'trending', label: `${sym.diamond}  Trending`, hint: 'most active tokens, priced' },
        { value: 'dips', label: `${sym.arrow}  Dip scanner`, hint: 'tokens pulling back now' },
        { value: 'lookup', label: `${sym.stack}  Look up a token`, hint: 'price, liquidity, chart' },
        { value: 'back', label: `${sym.chevron}  Back`, hint: 'return to the main menu' },
      ]);
      if (choice === 'back') return;
      if (choice === 'trending') await showTrending(ctx);
      else if (choice === 'dips') await showDips(ctx);
      else if (choice === 'lookup') {
        const mint = await askText('Token mint address', { placeholder: 'e.g. 8fQgfsRnRkKSe…pump' });
        if (mint) await showToken(ctx, mint);
      }
    }
  },
  register(cmd, ctx) {
    cmd.command('trending').description('trending tokens').action(() => showTrending(ctx, true));
    cmd.command('dips').description('tokens dipping now (1h)').action(() => showDips(ctx, true));
    cmd
      .command('token <mint>')
      .description('price, liquidity & chart for a token')
      .action((mint) => showToken(ctx, mint, true));
  },
};

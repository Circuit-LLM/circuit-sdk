import {
  c, palette, sym, clearScreen, slimHeader, compactBrand, panel, kv, heading,
  spinner, menuSelect, askText, askConfirm, askPassword, pressKey,
} from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { CIRC, SOL_MINT } from '../config.js';
import { makeWallet } from '../services/wallet.js';
import {
  loadKeypair, isValidAddress, walletExists, walletSource,
  generateKeypair, keypairFromInput, saveKeypair, secretKeyBase58,
} from '../services/solana.js';
import { priceFeed } from '../services/priceFeed.js';
import { money, tokenAmount, shortMint } from '../util/format.js';
import qrcode from 'qrcode-terminal';

// Render an address as a compact terminal QR (half-block). Synchronous — qrcode-terminal
// invokes the callback inline. Returns the lines, or null if anything goes wrong (we never
// want a QR failure to hide the address itself).
function qrLines(text) {
  try {
    let out = '';
    qrcode.generate(text, { small: true }, (s) => { out = s; });
    return out ? out.replace(/\n+$/, '').split('\n') : null;
  } catch {
    return null;
  }
}

// A bare header (no pressKey) for flows that prompt — keeps the prompt clean.
function flowHeader(ctx, standalone, title) {
  clearScreen();
  if (standalone) compactBrand();
  else {
    slimHeader(ctx.status);
    console.log('');
  }
  console.log(heading(title, sym.cube));
  console.log('');
}

async function importFlow(ctx, standalone) {
  flowHeader(ctx, standalone, 'Connect a wallet');
  console.log(c.dim('  Paste a base58 secret key (or a JSON byte array).'));
  console.log(c.dim('  It is saved to ~/.circuit/id.json, readable only by you (0600).'));
  console.log('');
  const key = await askPassword('Secret key (hidden)');
  if (!key) return;
  let kp;
  try {
    kp = keypairFromInput(key);
  } catch {
    console.log('\n  ' + c.err('That is not a valid Solana secret key.'));
    return pressKey('press any key to go back');
  }
  if (walletExists()) {
    const ok = await askConfirm('A wallet is already configured. Overwrite it?', { initialValue: false });
    if (!ok) return;
  }
  const path = saveKeypair(kp);
  console.log('\n  ' + c.ok(sym.check) + ' ' + c.text('Wallet connected  ') + c.accent(kp.publicKey.toBase58()));
  console.log('  ' + c.dim(`saved to ${path}`));
  if (process.env.CIRCUIT_WALLET) {
    console.log('  ' + c.warn('Note: CIRCUIT_WALLET is set and overrides this file — unset it to use the saved wallet.'));
  }
  await pressKey('press any key to go back');
}

async function generateFlow(ctx, standalone) {
  flowHeader(ctx, standalone, 'Generate a new wallet');
  if (walletExists()) {
    const ok = await askConfirm('A wallet already exists. Replace it with a brand-new one?', { initialValue: false });
    if (!ok) return;
  }
  const kp = generateKeypair();
  const path = saveKeypair(kp);
  console.log('  ' + c.ok(sym.check) + ' ' + c.text('New wallet  ') + c.accent(kp.publicKey.toBase58()));
  console.log('  ' + c.dim(`saved to ${path}`));
  console.log('');
  console.log('  ' + c.warn('Back up your key — it is the only way to recover this wallet.'));
  const reveal = await askConfirm('Reveal the secret key once, now, for backup?', { initialValue: false });
  if (reveal) {
    console.log('\n  ' + c.dim('secret key (base58) — store it safely, shown only once:'));
    console.log('  ' + c.text(secretKeyBase58(kp)));
  }
  console.log('\n  ' + c.muted('Fund it with SOL + CIRC to chat and transact.'));
  await pressKey('press any key to go back');
}

async function addressView(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, () => {
    const w = makeWallet();
    if (!w.address) return noWalletPanel();
    console.log(panel([heading('Address', sym.cube), '', c.accent(w.address)].join('\n'), { title: 'WALLET' }));
  });
}

async function balancesView(ctx, standalone, address) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const w = makeWallet(address ? { address } : {});
    if (!w.address) {
      noWalletPanel();
      return;
    }
    const sp = spinner('Reading balances…');
    let sol;
    let circ;
    let circUsd = null;
    try {
      [sol, circ] = await Promise.all([w.solBalance(), w.circBalance()]);
      circUsd = await priceFeed.prices([CIRC.mint]).then((p) => (p.results || p)[CIRC.mint]?.priceUsd).catch(() => null);
      sp.success('Balances');
    } catch (e) {
      sp.error(`RPC error: ${e.message}`);
      return;
    }
    console.log('');
    // Be transparent about WHICH wallet this is. If CIRCUIT_WALLET (env) is set it overrides a
    // wallet saved via the keystore — surface that so a surprising balance is explained, not silent.
    const src = w.readOnly ? null : walletSource();
    const rows = [
      heading('Wallet', sym.cube) + (w.readOnly ? c.dim('   (read-only)') : ''),
      '',
      kv('Address', c.text(w.address)),
    ];
    if (src && src.source !== 'none') rows.push(kv('Loaded from', c.dim(src.label)));
    rows.push(
      kv('SOL', c.text(tokenAmount(sol))),
      kv('CIRC', c.text(tokenAmount(circ)) + (circUsd && circ ? c.dim(`   (${money(circ * circUsd)})`) : '')),
    );
    if (src && src.overridesFile) {
      rows.push('', c.warn(`${sym.cross} CIRCUIT_WALLET (env) is overriding your saved ~/.circuit/id.json.`));
      rows.push(c.dim('   This is the wallet shown above. `unset CIRCUIT_WALLET` to use the one you connected.'));
    }
    console.log(panel(rows.join('\n'), { title: 'WALLET', color: palette.green }));
  });
}

function noWalletPanel() {
  console.log(
    panel(
      [
        c.warn('No wallet loaded.'),
        '',
        c.muted('Load a signing wallet to chat, pay and transfer:'),
        `  ${c.accent('export CIRCUIT_WALLET=<base58-secret-key>')}`,
        c.dim('  …or place a Solana keypair at ~/.circuit/id.json'),
      ].join('\n'),
      { title: 'WALLET', color: palette.amber },
    ),
  );
}

async function sendFlow(ctx) {
  const w = makeWallet();
  if (!w.keypair) {
    await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => noWalletPanel());
    return;
  }
  const token = await menuSelect(c.text('Send which asset?'), [
    { value: 'circ', label: `${sym.cube}  CIRC`, hint: 'Token-2022' },
    { value: 'sol', label: `${sym.spark}  SOL` },
  ]);
  const to = await askText('Recipient address');
  if (!to || !isValidAddress(to.trim())) {
    await flash(ctx, c.err('Invalid recipient address.'));
    return;
  }
  const amtStr = await askText(`Amount of ${token.toUpperCase()}`);
  const amt = Number(amtStr);
  if (!(amt > 0)) {
    await flash(ctx, c.err('Invalid amount.'));
    return;
  }
  const ok = await askConfirm(`Send ${amt} ${token.toUpperCase()} to ${shortMint(to.trim(), 6, 6)}?`, { initialValue: false });
  if (!ok) return;
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Submitting transaction…');
    try {
      const sig =
        token === 'circ'
          ? await w.sendCirc(to.trim(), BigInt(Math.round(amt * 10 ** CIRC.decimals)))
          : await w.sendSol(to.trim(), amt);
      sp.success('Sent');
      console.log('');
      console.log(`  ${c.ok(sym.check)} ${c.text(`${amt} ${token.toUpperCase()} sent`)}`);
      console.log(`  ${c.dim('tx')} ${c.accent(sig)}`);
    } catch (e) {
      sp.error(`Transfer failed: ${e.message}`);
    }
  });
}

async function swapFlow(ctx) {
  const w = makeWallet();
  if (!w.keypair) {
    await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => noWalletPanel());
    return;
  }
  const dir = await menuSelect(c.text('Swap direction'), [
    { value: 'sol-circ', label: `${sym.spark}  SOL → CIRC`, hint: 'buy CIRC' },
    { value: 'circ-sol', label: `${sym.cube}  CIRC → SOL`, hint: 'sell CIRC' },
  ]);
  const [inMint, outMint, inDec, inSym, outSym] =
    dir === 'sol-circ'
      ? [SOL_MINT, CIRC.mint, 9, 'SOL', 'CIRC']
      : [CIRC.mint, SOL_MINT, CIRC.decimals, 'CIRC', 'SOL'];
  const amtStr = await askText(`Amount of ${inSym} to swap`);
  const amt = Number(amtStr);
  if (!(amt > 0)) {
    await flash(ctx, c.err('Invalid amount.'));
    return;
  }
  const amountRaw = BigInt(Math.round(amt * 10 ** inDec));
  flowHeader(ctx, false, 'Swap');
  const sp = spinner('Fetching best route…');
  let quote;
  try {
    quote = await w.swapQuote(inMint, outMint, amountRaw.toString());
    sp.success('Quote');
  } catch (e) {
    sp.error(`No route: ${e.message}`);
    await pressKey('press any key to go back');
    return;
  }
  const outDec = outSym === 'SOL' ? 9 : CIRC.decimals;
  const out = Number(quote.outAmount) / 10 ** outDec;
  const impactPct = Number(quote.priceImpactPct) * 100 || 0;
  const impactStr = `${impactPct.toFixed(2)}%`;
  const SLIPPAGE_PCT = 1; // matches the 100-bps default used by swapQuote/swap
  console.log('');
  console.log(panel([
    kv('You pay', c.text(`${amt} ${inSym}`)),
    kv('You get', c.text(`≈ ${tokenAmount(out)} ${outSym}`)),
    kv('Price impact', impactPct >= 3 ? c.err(impactStr) : impactPct >= 1 ? c.warn(impactStr) : c.text(impactStr)),
    kv('Max slippage', c.text(`${SLIPPAGE_PCT}%`)),
  ].join('\n'), { title: 'SWAP QUOTE' }));
  if (impactPct >= 3) {
    console.log('\n  ' + c.err(`${sym.bolt} High price impact — this pool is thin, you may lose value. Try a smaller amount.`));
  }
  console.log('');
  // Confirm with the quote still on screen — don't scroll it away behind a pressKey first.
  const ok = await askConfirm('Execute this swap?', { initialValue: false });
  if (!ok) return;
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Swapping…');
    try {
      const { sig } = await w.swap(inMint, outMint, amountRaw.toString());
      sp.success('Swap complete');
      console.log(`\n  ${c.ok(sym.check)} swapped  ·  ${c.dim('tx')} ${c.accent(sig)}`);
    } catch (e) {
      sp.error(`Swap failed: ${e.message}`);
    }
  });
}

async function flash(ctx, line) {
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => console.log('  ' + line));
}

export default {
  id: 'wallet',
  icon: sym.cube,
  name: 'Wallet',
  desc: 'CIRC balance & transfers',
  async screen(ctx, opts = {}) {
    if (opts.standalone) return balancesView(ctx, true);
    for (;;) {
      clearScreen();
      slimHeader(ctx.status);
      const has = !!loadKeypair();
      const choices = has
        ? [
            { value: 'balances', label: `${sym.cube}  Balances`, hint: 'SOL + CIRC' },
            { value: 'receive', label: `${sym.arrow}  Receive`, hint: 'show your address' },
            { value: 'send', label: `${sym.spark}  Send`, hint: 'transfer CIRC or SOL' },
            { value: 'swap', label: `${sym.diamond}  Swap`, hint: 'SOL ↔ CIRC via Jupiter' },
            { value: 'import', label: `${sym.arrow}  Connect a different wallet` },
            { value: 'back', label: `${sym.chevron}  Back` },
          ]
        : [
            { value: 'import', label: `${sym.cube}  Connect a wallet`, hint: 'paste a secret key' },
            { value: 'generate', label: `${sym.spark}  Generate a new wallet`, hint: 'create a fresh keypair' },
            { value: 'back', label: `${sym.chevron}  Back` },
          ];
      const choice = await menuSelect(c.text('Wallet'), choices);
      if (choice === 'back') return;
      if (choice === 'balances') await balancesView(ctx);
      else if (choice === 'receive') {
        const w = makeWallet();
        await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => {
          if (!w.address) return noWalletPanel();
          // The QR is rendered raw (not boxed): boxen mis-counts half-block widths and
          // ragged-pads the border, and a QR reads cleaner unframed anyway.
          const qr = qrLines(w.address);
          console.log('');
          console.log('  ' + heading('Receive', sym.arrow));
          console.log('');
          if (qr) {
            for (const line of qr) console.log('  ' + line);
            console.log('');
            console.log('  ' + c.muted('Scan the code, or copy the address:'));
          } else {
            console.log('  ' + c.muted('Your address:'));
          }
          console.log('  ' + c.accent(w.address));
        });
      } else if (choice === 'send') await sendFlow(ctx);
      else if (choice === 'swap') await swapFlow(ctx);
      else if (choice === 'import') await importFlow(ctx);
      else if (choice === 'generate') await generateFlow(ctx);
    }
  },
  register(cmd, ctx) {
    cmd
      .command('balance [address]')
      .description('show SOL + CIRC balances')
      .action((address) => balancesView(ctx, true, address && isValidAddress(address) ? address : undefined));
    cmd.command('import').description('connect a wallet from a secret key').action(() => importFlow(ctx, true));
    cmd.command('generate').description('generate a new wallet keypair').action(() => generateFlow(ctx, true));
    cmd.command('address').description('show the loaded wallet address').action(() => addressView(ctx, true));
  },
};

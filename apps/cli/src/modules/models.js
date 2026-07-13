import {
  c, palette, sym, brand, clearScreen, slimHeader, heading, panel, kv,
  spinner, menuSelect, askText, askConfirm, pressKey,
} from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { isValidAddress } from '../services/solana.js';
import { makeWallet } from '../services/wallet.js';
import {
  makeModels, loadModelsKey, saveModelsKey, MODELS_KEY_FILE, DEFAULT_MODEL,
} from '../services/models.js';
import { money, shortMint, truncate } from '../util/format.js';

const TOKENS = ['SOL', 'USDC', 'CIRC'];

function noWalletPanel() {
  console.log(
    panel(
      [
        c.warn('No wallet loaded.'),
        '',
        c.muted('Buying credits and minting a key are signed by your wallet:'),
        `  ${c.accent('export CIRCUIT_WALLET=<base58-secret-key>')}`,
        c.dim('  …or connect one with  ') + c.accent('circuit wallet import'),
      ].join('\n'),
      { title: 'MODELS', color: palette.amber },
    ),
  );
}

// $ per 1M tokens from OpenRouter's per-token pricing string (markup already applied by the gateway).
function per1M(price) {
  const n = Number(price);
  if (!isFinite(n) || n <= 0) return null;
  return money(n * 1e6);
}

async function catalogView(ctx, standalone, { search, ids } = {}) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Loading catalog…');
    let models;
    try {
      models = await makeModels().catalog();
      sp.success(`Catalog · ${models.length} models`);
    } catch (e) {
      sp.error(`Catalog unavailable: ${e.message}`);
      return;
    }
    let rows = models;
    if (search) {
      const q = search.toLowerCase();
      rows = models.filter((m) => `${m.id} ${m.name ?? ''}`.toLowerCase().includes(q));
    }
    if (ids) {
      console.log('');
      for (const m of rows) console.log('  ' + c.text(m.id));
      return;
    }
    const shown = rows.slice(0, search ? rows.length : 30);
    console.log('');
    console.log('  ' + c.dim('model'.padEnd(42)) + c.dim('in /1M    out /1M'));
    for (const m of shown) {
      const inP = per1M(m.pricing?.prompt) ?? '—';
      const outP = per1M(m.pricing?.completion) ?? '—';
      console.log('  ' + c.text(truncate(m.id, 40).padEnd(42)) + c.muted(inP.padEnd(10)) + c.muted(outP));
    }
    if (!search && rows.length > shown.length) {
      console.log('\n  ' + c.dim(`… ${rows.length - shown.length} more · filter with `) + c.accent('circuit models list --search <q>'));
    }
    if (search && !rows.length) console.log('  ' + c.muted('no models match ') + c.text(`"${search}"`));
  });
}

async function accountView(ctx, standalone, address) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    const models = makeModels({ wallet: true });
    const addr = address || makeWallet().address;
    if (!addr) return noWalletPanel();
    const sp = spinner('Reading account…');
    let acct;
    try {
      acct = await models.account(addr);
      sp.success('Account');
    } catch (e) {
      sp.error(`Gateway error: ${e.message}`);
      return;
    }
    const stored = loadModelsKey();
    const rows = [
      heading('Models account', sym.diamond),
      '',
      kv('Wallet', c.text(addr)),
      kv('Balance', c.text(money(acct.balanceUsd))),
    ];
    if (acct.purchasedUsd != null) rows.push(kv('Purchased', c.dim(money(acct.purchasedUsd))));
    rows.push(kv('API key', acct.hasKey ? c.ok('issued') : c.warn('none — run `circuit models key`')));
    if (stored) rows.push(kv('Local key', c.dim(stored.source === 'env' ? 'CIRCUIT_MODELS_KEY (env)' : MODELS_KEY_FILE)));
    if (acct.orUsage && acct.orUsage.limit != null) {
      rows.push(kv('Spend limit', c.dim(`${money(acct.orUsage.usage)} / ${money(acct.orUsage.limit)}`)));
    }
    console.log(panel(rows.join('\n'), { title: 'MODELS', color: palette.green }));
  });
}

async function buyFlow(ctx, { token, usd } = {}) {
  const wallet = makeWallet();
  const models = makeModels({ wallet: true });
  if (!wallet.address) {
    await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => noWalletPanel());
    return;
  }
  // Interactive prompts fill anything the verb didn't pass.
  if (!token) token = await menuSelect(c.text('Pay with which token?'), TOKENS.map((t) => ({ value: t, label: `${sym.spark}  ${t}` })));
  token = String(token).toUpperCase();
  if (!TOKENS.includes(token)) {
    await flash(ctx, c.err(`Unsupported token "${token}" — use one of ${TOKENS.join(', ')}.`));
    return;
  }
  if (usd == null) usd = Number(await askText('How many USD of credits?', { placeholder: 'e.g. 5' }));
  usd = Number(usd);
  if (!(usd > 0)) {
    await flash(ctx, c.err('Enter a positive USD amount.'));
    return;
  }

  clearScreen();
  console.log('');
  console.log(heading('Buy credits', sym.diamond));
  console.log('');
  const qsp = spinner('Fetching quote…');
  let quote;
  try {
    quote = await models.quote(token, usd);
    qsp.success('Quote');
  } catch (e) {
    qsp.error(`Quote unavailable: ${e.message}`);
    await pressKey('press any key to go back');
    return;
  }
  console.log('');
  console.log(panel([
    kv('You pay', c.text(`≈ ${quote.amountTokens} ${token}`)),
    kv('You get', c.text(`${money(usd)} of credits`)),
    kv('Token price', c.dim(money(quote.priceUsd))),
    kv('Minimum', c.dim(money(quote.minUsd))),
  ].join('\n'), { title: 'PURCHASE' }));
  console.log('');
  const ok = await askConfirm(`Buy ${money(usd)} of credits with ${token}?`, { initialValue: false });
  if (!ok) return;

  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Paying and crediting your balance…');
    try {
      const r = await models.buy(token, usd);
      sp.success('Credited');
      console.log('');
      console.log(`  ${c.ok(sym.check)} ${c.text(`${money(r.creditedUsd ?? usd)} added`)}  ·  ${c.dim('balance')} ${c.accent(money(r.balanceUsd))}`);
      console.log(`  ${c.dim('payment tx')} ${c.accent(shortMint(r.paymentSig, 8, 8))}`);
      if (r.circuitKey) {
        const path = saveModelsKey({ circuitKey: r.circuitKey, base_url: 'https://circuitllm.xyz/api/v1', wallet: wallet.address });
        console.log('\n  ' + c.ok(sym.check) + ' ' + c.text('First API key issued: ') + c.accent(r.circuitKey));
        console.log('  ' + c.dim(`saved to ${path} (0600) — used by `) + c.accent('circuit models chat'));
      }
    } catch (e) {
      sp.error(`Purchase failed: ${e.message}`);
    }
  });
}

async function keyFlow(ctx, { save = true } = {}) {
  const wallet = makeWallet();
  const models = makeModels({ wallet: true });
  if (!wallet.address) {
    await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => noWalletPanel());
    return;
  }
  // If a key already exists, rotating invalidates the old one — make that explicit.
  let hasKey = false;
  try {
    hasKey = (await models.account()).hasKey;
  } catch {
    /* proceed; issueKey will surface any real error */
  }
  if (hasKey) {
    const ok = await askConfirm('A key already exists. Rotating invalidates it immediately. Continue?', { initialValue: false });
    if (!ok) return;
  }
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, async () => {
    const sp = spinner('Signing and issuing key…');
    let res;
    try {
      res = await models.issueKey();
      sp.success('API key issued');
    } catch (e) {
      sp.error(`Could not issue key: ${e.message}`);
      return;
    }
    console.log('');
    console.log('  ' + c.text('Circuit API key (shown once):'));
    console.log('  ' + c.accent(res.circuitKey));
    console.log('  ' + c.dim('base url  ') + c.text(res.base_url));
    if (save) {
      const path = saveModelsKey({ circuitKey: res.circuitKey, base_url: res.base_url, wallet: wallet.address });
      console.log('\n  ' + c.ok(sym.check) + c.dim(` saved to ${path} (0600) — used by `) + c.accent('circuit models chat'));
    } else {
      console.log('\n  ' + c.muted('Not saved. Use it with  ') + c.accent('export CIRCUIT_MODELS_KEY=' + res.circuitKey));
    }
  });
}

// ── chat (metered against your prepaid balance) ──────────────────────────────
function keyNote() {
  console.log(
    '\n  ' + c.warn('No Circuit API key found.') +
      '\n  ' + c.muted('Mint one (needs credits):  ') + c.accent('circuit models buy 5  &&  circuit models key') +
      '\n  ' + c.muted('…or set  ') + c.accent('export CIRCUIT_MODELS_KEY=sk-circuit-…') + '\n',
  );
}

function usageLine(usage) {
  if (!usage) return c.dim('  (no usage reported)');
  const t = usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
  return c.dim(`  ${sym.bolt} ${t} tokens`);
}

async function chatRepl(ctx, model) {
  clearScreen();
  slimHeader(ctx.status);
  console.log('');
  console.log(heading('Models chat', sym.diamond) + c.dim(`   ·   ${model}   ·   /exit to leave`));
  console.log('');
  if (!loadModelsKey()) {
    keyNote();
    return;
  }
  const models = makeModels({ key: true, model });
  const messages = [];
  for (;;) {
    const input = await askText(c.accent('you'), { placeholder: 'type a message · /exit to leave' });
    if (!input || input.trim() === '/exit' || input.trim() === '/quit') break;
    messages.push({ role: 'user', content: input });
    let first = true;
    try {
      const gen = models.chatStream({ messages });
      let ret;
      for (;;) {
        const n = await gen.next();
        if (n.done) { ret = n.value; break; }
        if (first) {
          first = false;
          process.stdout.write(`\n${brand('circuit')} ${c.dim(sym.chevron)} `);
        }
        process.stdout.write(c.text(n.value));
      }
      if (ret?.content?.trim()) {
        messages.push({ role: 'assistant', content: ret.content });
        process.stdout.write('\n');
      } else {
        process.stdout.write('\n  ' + c.warn(`${sym.bolt} no content returned`) + '\n');
      }
      console.log(usageLine(ret?.usage));
      console.log('');
    } catch (e) {
      console.log('\n  ' + c.err(e.message) + '\n');
      messages.pop();
    }
  }
  console.log(c.dim('\n  left the chat.\n'));
}

async function chatOneShot(ctx, prompt, opts) {
  const model = opts.model || DEFAULT_MODEL;
  if (!loadModelsKey()) {
    keyNote();
    process.exitCode = 1;
    return;
  }
  const models = makeModels({ key: true, model });
  const messages = opts.system
    ? [{ role: 'system', content: opts.system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  const reqOpts = { messages, temperature: opts.temp, maxTokens: opts.maxTokens };
  try {
    if (opts.json) {
      const res = await models.chat(reqOpts);
      console.log(JSON.stringify({ content: res.content, usage: res.usage }, null, 2));
      return;
    }
    const gen = models.chatStream(reqOpts);
    let ret;
    for (;;) {
      const n = await gen.next();
      if (n.done) { ret = n.value; break; }
      process.stdout.write(n.value); // raw → pipe-friendly
    }
    process.stdout.write('\n');
    if (ret?.usage) process.stderr.write(usageLine(ret.usage) + '\n');
  } catch (e) {
    process.stderr.write(c.err(e.message) + '\n');
    process.exitCode = 1;
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let d = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (d += chunk));
    process.stdin.on('end', () => resolve(d));
  });
}

async function flash(ctx, line) {
  await screenFrame({ status: ctx.status, footer: 'press any key to go back' }, () => console.log('  ' + line));
}

export default {
  id: 'models',
  icon: sym.diamond,
  name: 'Models',
  desc: 'Buy credits & call any model (OpenAI-compatible)',
  async screen(ctx, opts = {}) {
    if (opts.standalone) return accountView(ctx, true);
    for (;;) {
      clearScreen();
      slimHeader(ctx.status);
      const choice = await menuSelect(c.text('Models'), [
        { value: 'account', label: `${sym.diamond}  Balance & key`, hint: 'your credits + API key' },
        { value: 'buy', label: `${sym.spark}  Buy credits`, hint: 'USDC / SOL / CIRC' },
        { value: 'key', label: `${sym.cube}  Issue / rotate key`, hint: 'OpenAI-compatible key' },
        { value: 'catalog', label: `${sym.stack}  Browse models`, hint: 'catalog + pricing' },
        { value: 'chat', label: `${sym.bolt}  Chat`, hint: 'metered against your balance' },
        { value: 'back', label: `${sym.chevron}  Back` },
      ]);
      if (choice === 'back') return;
      if (choice === 'account') await accountView(ctx);
      else if (choice === 'buy') await buyFlow(ctx);
      else if (choice === 'key') await keyFlow(ctx);
      else if (choice === 'catalog') await catalogView(ctx);
      else if (choice === 'chat') await chatRepl(ctx, DEFAULT_MODEL);
    }
  },
  register(cmd, ctx) {
    cmd.description('buy credits, mint a key, and call any model (OpenAI-compatible reseller)');

    cmd
      .command('list')
      .description('browse the model catalog (with Circuit markup applied)')
      .option('--ids', 'print model ids only (pipe-friendly)')
      .option('-s, --search <q>', 'filter by id / name')
      .action((options) => catalogView(ctx, true, { search: options.search, ids: options.ids }));

    cmd
      .command('balance [address]')
      .description('show credit balance + API-key status')
      .action((address) => accountView(ctx, true, address && isValidAddress(address) ? address : undefined));

    cmd
      .command('buy [usd]')
      .description('buy credits with SOL / USDC / CIRC')
      .option('-t, --token <sym>', 'token to pay with (SOL | USDC | CIRC)', 'SOL')
      .action((usd, options) => buyFlow(ctx, { token: options.token, usd: usd != null ? Number(usd) : undefined }));

    cmd
      .command('key')
      .description('issue or rotate your Circuit API key (wallet-signed)')
      .option('--no-save', 'print the key but do not write it to ~/.circuit/models-key.json')
      .action((options) => keyFlow(ctx, { save: options.save !== false }));

    cmd
      .command('chat [prompt...]')
      .description('chat with any model, metered against your credits')
      .option('--json', 'output raw JSON (non-streaming)')
      .option('-m, --model <id>', 'model id (e.g. openai/gpt-4o-mini)', DEFAULT_MODEL)
      .option('-t, --temp <n>', 'temperature', parseFloat)
      .option('-s, --system <prompt>', 'system prompt')
      .option('--max-tokens <n>', 'max tokens', (v) => parseInt(v, 10))
      .action(async (promptParts, options) => {
        let prompt = (promptParts || []).join(' ').trim();
        if (!process.stdin.isTTY) {
          const piped = (await readStdin()).trim();
          prompt = [piped, prompt].filter(Boolean).join('\n\n');
        }
        if (!prompt) return chatRepl(ctx, options.model || DEFAULT_MODEL);
        await chatOneShot(ctx, prompt, options);
      });
  },
};

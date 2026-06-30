import {
  c, sym, brand, clearScreen, slimHeader, heading, askText,
} from '../ui/index.js';
import { config } from '../config.js';
import { chat, chatStream, listModels } from '../services/inference.js';
import { makeWallet } from '../services/wallet.js';
import { shortMint } from '../util/format.js';

function costLine(res) {
  if (!res.payment) return c.dim('  (no charge)');
  const usd = res.payment.usdEquivalent != null ? `$${res.payment.usdEquivalent}` : '';
  return c.dim(`  ${sym.bolt} ${res.payment.amountDisplay}  ·  ${usd}  ·  tx ${shortMint(res.paymentTx || '', 6, 4)}`);
}

function noWalletNote(payment) {
  console.log(
    '\n  ' +
      c.warn(`Payment required (${payment?.amountDisplay ?? '≈401 CIRC'}) to run inference.`) +
      '\n  ' +
      c.muted('Load a funded wallet:  ') +
      c.accent('export CIRCUIT_WALLET=<base58-secret-key>') +
      '\n',
  );
}

// Interactive streaming REPL.
async function repl(ctx) {
  clearScreen();
  slimHeader(ctx.status);
  console.log('');
  console.log(heading('Chat', sym.bolt) + c.dim('   ·   the decentralized 72B   ·   /exit to leave'));
  console.log('');
  const wallet = makeWallet();
  if (!wallet.keypair) {
    console.log(
      c.muted('  Heads up: chat pays ~401 CIRC (~$0.03) per turn via x402.\n  Connect a wallet with ') +
        c.accent('circuit wallet import') +
        c.muted(' to enable it.\n'),
    );
  }
  const messages = config.systemPrompt ? [{ role: 'system', content: config.systemPrompt }] : [];
  for (;;) {
    const input = await askText(c.accent('you'), { placeholder: 'type a message · /exit to leave' });
    if (!input || input.trim() === '/exit' || input.trim() === '/quit') break;
    messages.push({ role: 'user', content: input });

    let firstToken = true;
    try {
      const res = await chatStream(messages, {}, wallet, {
        onPay: (p) =>
          process.stdout.write(c.dim(`  ${sym.bolt} paying ${p.amountDisplay} for this turn…\n`)),
        onToken: (t) => {
          if (firstToken) {
            firstToken = false;
            process.stdout.write(`\n${brand('circuit')} ${c.dim(sym.chevron)} `);
          }
          process.stdout.write(c.text(t));
        },
      });
      if (res.content && res.content.trim()) {
        messages.push({ role: 'assistant', content: res.content });
        process.stdout.write('\n');
      } else {
        // 200 with no tokens — don't append an empty turn or render it as a normal reply.
        process.stdout.write('\n  ' + c.warn(`${sym.bolt} no content returned`) + '\n');
      }
      console.log(costLine(res));
      console.log('');
    } catch (e) {
      if (e.name === 'PaymentRequiredError') {
        noWalletNote(e.payment);
        messages.pop();
      } else {
        console.log('\n  ' + c.err(e.message) + '\n');
        messages.pop();
      }
    }
  }
  console.log(c.dim('\n  left the chat.\n'));
}

// One-shot: `circuit chat "prompt"` or piped stdin.
async function oneShot(ctx, prompt, opts) {
  const wallet = makeWallet();
  const sys = opts.system ?? config.systemPrompt;
  const messages = sys
    ? [{ role: 'system', content: sys }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }];
  const reqOpts = { model: opts.model, temperature: opts.temp, maxTokens: opts.maxTokens };

  if (opts.json) {
    const res = await chat(messages, reqOpts, wallet);
    console.log(JSON.stringify({ content: res.content, usage: res.usage, paymentTx: res.paymentTx }, null, 2));
    return;
  }
  try {
    const res = await chatStream(messages, reqOpts, wallet, {
      onToken: (t) => process.stdout.write(t), // raw → pipe-friendly
    });
    process.stdout.write('\n');
    if (res.payment) process.stderr.write(costLine(res) + '\n');
  } catch (e) {
    if (e.name === 'PaymentRequiredError') noWalletNote(e.payment);
    else process.stderr.write(c.err(e.message) + '\n');
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

export default {
  id: 'chat',
  icon: sym.bolt,
  name: 'Chat',
  desc: 'Talk to the decentralized DLLM',
  screen(ctx) {
    return repl(ctx);
  },
  register(cmd, ctx) {
    cmd
      .description('talk to the decentralized DLLM (paid in CIRC via x402)')
      .argument('[prompt...]', 'prompt text (omit for the interactive REPL)')
      .option('--json', 'output raw JSON (non-streaming)')
      .option('-m, --model <id>', 'model id')
      .option('-t, --temp <n>', 'temperature', parseFloat)
      .option('-s, --system <prompt>', 'system prompt (overrides the default)')
      .option('--max-tokens <n>', 'max tokens', (v) => parseInt(v, 10))
      .option('--models', 'list available models and exit')
      .action(async (promptParts, options) => {
        if (options.models) {
          const models = await listModels();
          console.log(models.join('\n'));
          return;
        }
        let prompt = (promptParts || []).join(' ').trim();
        if (!process.stdin.isTTY) {
          const piped = (await readStdin()).trim();
          prompt = [piped, prompt].filter(Boolean).join('\n\n');
        }
        if (!prompt) return repl(ctx);
        await oneShot(ctx, prompt, options);
      });
  },
};

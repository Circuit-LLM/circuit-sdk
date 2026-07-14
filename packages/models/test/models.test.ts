import { test } from 'node:test';
import assert from 'node:assert';
import { Models, ModelsError, modelsAuthMessage } from '../src/models.ts';
import type { Wallet } from '@circuit-llm/wallet';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sseResp(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

// A minimal stand-in for @circuit-llm/wallet — only the members Models touches.
function fakeWallet(over: Partial<Wallet> = {}): Wallet {
  return {
    address: 'Wa11etAddr1111111111111111111111111111111111',
    signMessage: () => 'SIGB58',
    signAndSendTransaction: async () => 'PAYSIG',
    ...over,
  } as unknown as Wallet;
}

test('modelsAuthMessage matches the gateway canonical format', () => {
  assert.equal(modelsAuthMessage('W', 123), 'Circuit Models\nwallet:W\nts:123');
});

test('catalog() returns the data array; listModelIds() maps ids', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/models/catalog')) return jsonResp(200, { markup_bps: 500, count: 1, data: [{ id: 'openai/gpt-4o-mini' }] });
    if (url.endsWith('/v1/models')) return jsonResp(200, { data: [{ id: 'a' }, { id: 'b' }] });
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const m = new Models({ fetchImpl });
  assert.deepEqual((await m.catalog()).map((x) => x.id), ['openai/gpt-4o-mini']);
  assert.deepEqual(await m.listModelIds(), ['a', 'b']);
});

test('chat() sends the Bearer key and returns trimmed content + usage', async () => {
  let auth: string | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    auth = (init.headers as Record<string, string>).Authorization;
    return jsonResp(200, { choices: [{ message: { content: ' hey ' } }], usage: { total_tokens: 7 } });
  }) as typeof fetch;
  const m = new Models({ apiKey: 'sk-circuit-abc', model: 'openai/gpt-4o-mini', fetchImpl });
  const r = await m.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(auth, 'Bearer sk-circuit-abc');
  assert.equal(r.content, 'hey');
  assert.equal(r.usage?.total_tokens, 7);
});

test('chat() with no key throws before fetching', async () => {
  const m = new Models({ model: 'x', fetchImpl: (async () => jsonResp(200, {})) as typeof fetch });
  await assert.rejects(() => m.chat({ messages: [] }), /Circuit API key/);
});

test('chat() with no model throws', async () => {
  const m = new Models({ apiKey: 'sk-circuit-x', fetchImpl: (async () => jsonResp(200, {})) as typeof fetch });
  await assert.rejects(() => m.chat({ messages: [] }), /no model set/);
});

test('chat() surfaces a non-2xx as ModelsError with status + body', async () => {
  const fetchImpl = (async () => jsonResp(402, { error: { message: 'insufficient credits' } })) as typeof fetch;
  const m = new Models({ apiKey: 'sk-circuit-x', model: 'x', fetchImpl });
  await assert.rejects(
    () => m.chat({ messages: [] }),
    (e: unknown) => e instanceof ModelsError && e.status === 402 && /insufficient credits/.test(e.message),
  );
});

test('chatStream() yields deltas and returns assembled content + usage', async () => {
  const fetchImpl = (async () =>
    sseResp([
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      'data: {"usage":{"total_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;
  const m = new Models({ apiKey: 'sk-circuit-x', model: 'x', fetchImpl });
  const gen = m.chatStream({ messages: [{ role: 'user', content: 'hi' }] });
  const tokens: string[] = [];
  let ret: { content: string; usage: { total_tokens?: number } | null } | undefined;
  for (;;) {
    const n = await gen.next();
    if (n.done) { ret = n.value; break; }
    tokens.push(n.value);
  }
  assert.deepEqual(tokens, ['He', 'llo']);
  assert.equal(ret?.content, 'Hello');
  assert.equal(ret?.usage?.total_tokens, 2);
});

test('issueKey() signs the canonical message and posts {wallet, ts, sig}', async () => {
  let body: { wallet?: string; ts?: number; sig?: string } = {};
  let signed: string | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return jsonResp(200, { ok: true, circuitKey: 'sk-circuit-new', base_url: 'https://circuitllm.xyz/api/v1' });
  }) as typeof fetch;
  const wallet = fakeWallet({ signMessage: ((msg: string) => { signed = msg; return 'SIGB58'; }) as Wallet['signMessage'] });
  const m = new Models({ wallet, fetchImpl });
  const r = await m.issueKey();
  assert.equal(r.circuitKey, 'sk-circuit-new');
  assert.equal(body.wallet, wallet.address);
  assert.equal(body.sig, 'SIGB58');
  assert.equal(signed, modelsAuthMessage(wallet.address!, body.ts!));
});

test('buy() builds, signs+sends, and polls verify until confirmed', async () => {
  let sent: string | undefined;
  const verifies: unknown[] = [{ ok: true, pending: true }, { ok: true, creditedUsd: 5, balanceUsd: 5 }];
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/purchase/build')) return jsonResp(200, { transaction: 'BASE64TX', token: 'SOL', amountTokens: 0.03, usd: 5, priceUsd: 160, payTo: 'PayTo' });
    if (url.endsWith('/purchase/verify')) return jsonResp(200, verifies.shift());
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const wallet = fakeWallet({ signAndSendTransaction: (async (tx: string) => { sent = tx; return 'PAYSIG'; }) as Wallet['signAndSendTransaction'] });
  const m = new Models({ wallet, fetchImpl });
  const r = await m.buy('SOL', 5, { pollMs: 1 });
  assert.equal(sent, 'BASE64TX');
  assert.equal(r.paymentSig, 'PAYSIG');
  assert.equal(r.creditedUsd, 5);
  assert.equal(r.balanceUsd, 5);
});

test('wallet-gated methods throw without a wallet', async () => {
  const m = new Models({ fetchImpl: (async () => jsonResp(200, {})) as typeof fetch });
  await assert.rejects(() => m.issueKey(), /needs a wallet/);
  await assert.rejects(() => m.buy('SOL', 5), /needs a wallet/);
});

test('buy() keeps polling through a transient verify error, then succeeds', async () => {
  const verify = [
    () => jsonResp(500, { error: 'blip' }), // transient → req() throws; must NOT abort the loop
    () => jsonResp(200, { ok: true, pending: true }),
    () => jsonResp(200, { ok: true, creditedUsd: 5, balanceUsd: 5 }),
  ];
  let i = 0;
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/purchase/build')) return jsonResp(200, { transaction: 'TX', payTo: 'PayTo', token: 'SOL', amountTokens: 0.03, usd: 5, priceUsd: 160 });
    if (url.endsWith('/purchase/verify')) return (verify[i++] ?? verify[verify.length - 1])!();
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const m = new Models({ wallet: fakeWallet(), fetchImpl });
  const r = await m.buy('SOL', 5, { pollMs: 1 });
  assert.equal(r.creditedUsd, 5);
  assert.equal(r.paymentSig, 'PAYSIG');
});

test('buy() throws with paymentSig when it never confirms before the deadline', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/purchase/build')) return jsonResp(200, { transaction: 'TX', payTo: 'PayTo' });
    if (url.endsWith('/purchase/verify')) return jsonResp(200, { ok: true, pending: true }); // never settles
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const m = new Models({ wallet: fakeWallet(), fetchImpl });
  await assert.rejects(
    () => m.buy('SOL', 5, { pollMs: 1, timeoutMs: 5 }),
    (e: unknown) =>
      e instanceof ModelsError && /paymentSig PAYSIG/.test(e.message) && (e.body as { paymentSig?: string })?.paymentSig === 'PAYSIG',
  );
});

test('buy() recovers the signature when the wallet reports the tx unconfirmed', async () => {
  const wallet = fakeWallet({
    signAndSendTransaction: (async () => {
      const e = new Error('broadcast but not confirmed') as Error & { signature?: string };
      e.signature = 'RECOVERED';
      throw e;
    }) as Wallet['signAndSendTransaction'],
  });
  const fetchImpl = (async (url: string) => {
    if (url.endsWith('/purchase/build')) return jsonResp(200, { transaction: 'TX', payTo: 'PayTo' });
    if (url.endsWith('/purchase/verify')) return jsonResp(200, { ok: true, creditedUsd: 5, balanceUsd: 5 });
    throw new Error('unexpected ' + url);
  }) as typeof fetch;
  const m = new Models({ wallet, fetchImpl });
  const r = await m.buy('SOL', 5, { pollMs: 1 });
  assert.equal(r.paymentSig, 'RECOVERED');
});

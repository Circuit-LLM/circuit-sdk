import { test } from 'node:test';
import assert from 'node:assert';
import {
  X402Client,
  PaymentRequiredError,
  SpendCapError,
  X402RequestError,
  type PaymentWallet,
} from '../src/client.ts';

function resp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const QUOTE = {
  payment: { recipient: 'TREASURY', amountRaw: '300000000', amountDisplay: '300.00 CIRC', token: 'mint' },
};

test('passes a 200 through with no payment', async () => {
  const c = new X402Client();
  const r = await c.request(async () => resp(200, { ok: true }));
  assert.equal(r.paymentTx, null);
  assert.equal(r.resp.status, 200);
});

test('402 with no wallet throws PaymentRequiredError carrying the parsed quote', async () => {
  const c = new X402Client();
  await assert.rejects(
    () => c.request(async () => resp(402, QUOTE)),
    (e: unknown) =>
      e instanceof PaymentRequiredError &&
      e.quote?.amountRaw === 300_000_000n &&
      e.quote?.recipient === 'TREASURY',
  );
});

test('402 with a wallet pays then retries with X-Payment-Signature', async () => {
  let paid: { to: string; amt: bigint } | null = null;
  let sent: string | undefined;
  let calls = 0;
  const wallet: PaymentWallet = {
    async sendCirc(to, amt) {
      paid = { to, amt };
      return 'SIG123';
    },
  };
  const c = new X402Client({ wallet });
  const r = await c.request(async (extra) => {
    calls++;
    if (calls === 1) return resp(402, QUOTE);
    sent = extra['X-Payment-Signature'];
    return resp(200, { ok: true });
  });
  assert.deepEqual(paid, { to: 'TREASURY', amt: 300_000_000n });
  assert.equal(sent, 'SIG123');
  assert.equal(r.paymentTx, 'SIG123');
  assert.equal(r.resp.status, 200);
});

test('spend cap rejects an over-quote WITHOUT paying', async () => {
  let called = false;
  const wallet: PaymentWallet = {
    async sendCirc() {
      called = true;
      return 'x';
    },
  };
  const c = new X402Client({ wallet, maxSpendRaw: 100_000_000n });
  await assert.rejects(() => c.request(async () => resp(402, QUOTE)), SpendCapError);
  assert.equal(called, false);
});

test('one free retry on a transient error after paying', async () => {
  let calls = 0;
  const wallet: PaymentWallet = { async sendCirc() { return 'SIG'; } };
  const c = new X402Client({ wallet, retryDelayMs: 1 });
  const r = await c.request(async () => {
    calls++;
    if (calls === 1) return resp(402, QUOTE);
    if (calls === 2) return resp(503, {});
    return resp(200, { ok: 1 });
  });
  assert.equal(calls, 3);
  assert.equal(r.resp.status, 200);
});

test('json() parses the body and returns paymentTx', async () => {
  const wallet: PaymentWallet = { async sendCirc() { return 'SIG'; } };
  const c = new X402Client({ wallet });
  let calls = 0;
  const stub = (async () => {
    calls++;
    return calls === 1 ? resp(402, QUOTE) : resp(200, { value: 42 });
  }) as typeof fetch;
  const cc = new X402Client({ wallet, fetchImpl: stub });
  const r = await cc.json<{ value: number }>('http://x');
  assert.equal(r.data.value, 42);
  assert.equal(r.paymentTx, 'SIG');
  void c;
});

test('json() throws X402RequestError on a non-2xx final response', async () => {
  const stub = (async () => resp(404, { error: 'nope' })) as typeof fetch;
  const c = new X402Client({ fetchImpl: stub });
  await assert.rejects(
    () => c.json('http://x'),
    (e: unknown) => e instanceof X402RequestError && e.status === 404 && (e.body as any).error === 'nope',
  );
});

test('onPay hook fires before the wallet is charged', async () => {
  const order: string[] = [];
  const wallet: PaymentWallet = {
    async sendCirc() {
      order.push('pay');
      return 'SIG';
    },
  };
  const c = new X402Client({ wallet, onPay: () => { order.push('hook'); } });
  await c.request(async (extra) => (extra['X-Payment-Signature'] ? resp(200, {}) : resp(402, QUOTE)));
  assert.deepEqual(order, ['hook', 'pay']);
});

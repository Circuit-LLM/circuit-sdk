import { test } from 'node:test';
import assert from 'node:assert';
import { Data } from '../src/data.ts';
import { X402RequestError, type PaymentWallet } from '@circuit/x402';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const QUOTE = { payment: { recipient: 'T', amountRaw: '1000000', amountDisplay: '1.00 CIRC' } };
const wallet: PaymentWallet = { async sendCirc() { return 'PAYSIG'; } };

test('free endpoint returns the parsed body (no payment)', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => {
    url = u;
    return jsonResp(200, { service: 'circuit-data-api' });
  }) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  const q = (await data.quote()) as { service: string };
  assert.equal(q.service, 'circuit-data-api');
  assert.equal(url, 'https://api.test/api/quote');
});

test('paid endpoint pays on 402 and builds the query string', async () => {
  let calls = 0;
  let paidUrl: string | undefined;
  const fetchImpl = (async (u: string) => {
    calls++;
    if (calls === 1) {
      paidUrl = u;
      return jsonResp(402, QUOTE);
    }
    return jsonResp(200, { price: 0.0421 });
  }) as typeof fetch;
  const data = new Data({ wallet, fetchImpl, baseUrl: 'https://api.test' });
  const r = (await data.tokenPrice('MINT123')) as { price: number };
  assert.equal(r.price, 0.0421);
  assert.equal(paidUrl, 'https://api.test/api/token-price?mint=MINT123');
});

test('csv joins multiple mints', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => {
    url = u;
    return jsonResp(200, {});
  }) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  await data.prices(['A', 'B', 'C']);
  assert.equal(url, 'https://api.test/api/prices?mints=A%2CB%2CC');
});

test('non-2xx surfaces as X402RequestError', async () => {
  const fetchImpl = (async () => jsonResp(500, { error: 'boom' })) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  await assert.rejects(() => data.marketOverview(), (e: unknown) => e instanceof X402RequestError && e.status === 500);
});

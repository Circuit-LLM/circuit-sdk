import { test } from 'node:test';
import assert from 'node:assert';
import { Data } from '../src/data.ts';
import { X402RequestError, type PaymentWallet } from '@circuit-llm/x402';

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

// ── path-style analytics suite (circuit-node endpoints fronted on the data-api) ──
test('token analytics methods build path-style URLs (encoded)', async () => {
  const seen: Record<string, string> = {};
  const mk = (name: string) => (async (u: string) => { seen[name] = u; return jsonResp(200, {}); }) as typeof fetch;
  const D = (name: string) => new Data({ fetchImpl: mk(name), baseUrl: 'https://api.test' });

  await D('smart').tokenSmartMoney('MINT/1');           // slash must be encoded
  await D('velocity').tokenVelocity('MINT1');
  await D('list').tokenList({ limit: 5 });
  await D('full').tokenFull('MINT1');
  await D('phist').tokenPriceHistory('MINT1', { limit: 3 });

  assert.equal(seen.smart, 'https://api.test/api/token/MINT%2F1/smart-money');
  assert.equal(seen.velocity, 'https://api.test/api/token/MINT1/velocity');
  assert.equal(seen.list, 'https://api.test/api/token/list?limit=5');
  assert.equal(seen.full, 'https://api.test/api/token/MINT1');
  assert.equal(seen.phist, 'https://api.test/api/token/MINT1/price/history?limit=3');
});

test('wallet analytics methods build path-style URLs (encoded)', async () => {
  const seen: Record<string, string> = {};
  const mk = (name: string) => (async (u: string) => { seen[name] = u; return jsonResp(200, {}); }) as typeof fetch;
  const D = (name: string) => new Data({ fetchImpl: mk(name), baseUrl: 'https://api.test' });

  await D('rank').walletRank('WALL1');
  await D('nwh').walletNetworthHistory('WALL1', { limit: 10 });
  await D('transfers').walletTransfers('WALL1');

  assert.equal(seen.rank, 'https://api.test/api/wallet/WALL1/rank');
  assert.equal(seen.nwh, 'https://api.test/api/wallet/WALL1/networth/history?limit=10');
  assert.equal(seen.transfers, 'https://api.test/api/wallet/WALL1/transfers');
});

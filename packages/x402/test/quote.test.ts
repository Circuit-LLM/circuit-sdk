import { test } from 'node:test';
import assert from 'node:assert';
import { circRawFromUsd, formatCirc, parse402, CircPriceOracle } from '../src/quote.ts';
import { CIRC_MINT } from '../src/constants.ts';

test('circRawFromUsd rounds up to a whole CIRC, then to raw units', () => {
  assert.equal(circRawFromUsd(0.03, 0.0001), 300_000_000n); // 300 CIRC
  assert.equal(circRawFromUsd(0.001, 0.0001), 10_000_000n); // 10 CIRC
  assert.equal(circRawFromUsd(0.00015, 0.0001), 2_000_000n); // 1.5 → ceil 2 CIRC
});

test('circRawFromUsd uses the fallback rate when given 0', () => {
  assert.equal(circRawFromUsd(0.0001, 0), 1_000_000n); // 0.0001 / 0.0001 = 1 CIRC
});

test('formatCirc renders raw base units', () => {
  assert.equal(formatCirc(300_000_000n), '300.00');
  assert.equal(formatCirc(1_500_000n), '1.50');
});

test('parse402 reads a valid payment block', () => {
  const q = parse402({ payment: { recipient: 'T', amountRaw: '5000000', token: 'm' } });
  assert.ok(q);
  assert.equal(q.recipient, 'T');
  assert.equal(q.amountRaw, 5_000_000n);
  assert.equal(q.amountDisplay, '5.00 CIRC');
});

test('parse402 returns null without usable requirements', () => {
  assert.equal(parse402({ error: 'x' }), null);
  assert.equal(parse402({ payment: { recipient: 'T' } }), null);
  assert.equal(parse402(null), null);
});

test('CircPriceOracle caches, then falls back to last-known on a failed fetch', async () => {
  let calls = 0;
  let clock = 0;
  const fetchImpl = (async () => {
    calls++;
    if (calls === 1) {
      return new Response(JSON.stringify({ [CIRC_MINT]: { usdPrice: 0.0002 } }), { status: 200 });
    }
    return new Response('err', { status: 500 });
  }) as typeof fetch;

  const o = new CircPriceOracle({ fetchImpl, now: () => clock, cacheTtlMs: 100, lastKnownTtlMs: 10_000 });
  assert.equal(await o.get(), 0.0002); // live fetch
  clock = 50;
  assert.equal(await o.get(), 0.0002); // served from cache (no fetch)
  clock = 200;
  assert.equal(await o.get(), 0.0002); // cache expired → fetch fails → last-known-good
  assert.equal(calls, 2);
});

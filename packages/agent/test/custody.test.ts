import { test } from 'node:test';
import assert from 'node:assert';
import { SignerCustody, MockCustody } from '../src/custody.ts';

function resp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('SignerCustody posts {epoch, token, intent} and returns the signed result', async () => {
  let captured: { url: string; body: any } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    captured = { url, body: JSON.parse(init.body as string) };
    return resp(200, { code: 'signed', signature: 'ATTEST', paper: true, daySpentSol: 0.01 });
  }) as unknown as typeof fetch;
  const c = new SignerCustody({ signerUrl: 'http://signer', agentId: 'a1', epoch: 7, session: 'TOK', fetchImpl });
  const r = await c.buy('MINT', 0.01);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'signed');
  assert.equal(r.signature, 'ATTEST');
  assert.equal(captured?.url, 'http://signer/v1/agents/a1/intent');
  assert.equal(captured?.body.epoch, 7);
  assert.equal(captured?.body.token, 'TOK');
  assert.deepEqual(captured?.body.intent, { kind: 'buy', token: 'MINT', sizeSol: 0.01 });
});

test('SignerCustody surfaces a rejection code (fenced) without throwing', async () => {
  const fetchImpl = (async () => resp(403, { code: 'fenced', error: 'stale session' })) as unknown as typeof fetch;
  const c = new SignerCustody({ signerUrl: 'http://s', agentId: 'a', epoch: 1, session: 't', fetchImpl });
  const r = await c.sell('MINT', { amount: 100 });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'fenced');
  assert.equal(r.error, 'stale session');
});

test('SignerCustody returns signer-unreachable on a network error', async () => {
  const fetchImpl = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  const c = new SignerCustody({ signerUrl: 'http://s', agentId: 'a', epoch: 1, session: 't', fetchImpl });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'signer-unreachable');
});

test('MockCustody paper-signs a valid buy + tracks daily spend', async () => {
  const c = new MockCustody({ now: () => 0 });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'paper-local');
  assert.equal(r.signature, null);
  assert.equal(r.daySpentSol, 0.01);
});

test('MockCustody enforces the cooldown', async () => {
  let t = 0;
  const c = new MockCustody({ now: () => t, policy: { cooldownMs: 1000 } });
  assert.equal((await c.buy('M', 0.01)).ok, true);
  assert.equal((await c.buy('M', 0.01)).code, 'cooldown'); // same instant
  t = 1000;
  assert.equal((await c.buy('M', 0.01)).ok, true); // cooldown elapsed
});

test('MockCustody enforces per-trade + daily caps', async () => {
  const c = new MockCustody({ now: () => 0, policy: { maxNotionalSol: 0.05, maxDailySol: 0.08, cooldownMs: 0 } });
  assert.equal((await c.buy('M', 0.1)).code, 'over-trade-cap');
  assert.equal((await c.buy('M', 0.05)).ok, true); // 0.05 spent
  assert.equal((await c.buy('M', 0.05)).code, 'over-daily-cap'); // 0.05 + 0.05 > 0.08
});

test('MockCustody honors allow + denyTokens', async () => {
  const c = new MockCustody({ now: () => 0, policy: { allow: ['buy'], denyTokens: ['BAD'], cooldownMs: 0 } });
  assert.equal((await c.sell('M', { sizeSol: 0.01 })).code, 'action-not-allowed');
  assert.equal((await c.buy('BAD', 0.01)).code, 'token-denied');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { LocalKeypairCustody, CircuitAgent, type TradeExecutor } from '../src/index.ts';
import type { Intent } from '../src/types.ts';
import type { VerifiedIntent } from '@circuit/attest';

// A recording executor stands in for the real self-custody path (walletTradeExecutor → Jupiter).
function recorder(result = { signature: 'SIG_TX', solValue: 0.01 }) {
  const calls: { intent: Intent; vi?: VerifiedIntent }[] = [];
  const executor: TradeExecutor = {
    async execute(intent, vi) { calls.push({ intent, vi }); return result; },
  };
  return { executor, calls };
}

test('LocalKeypairCustody (paper) paper-signs a valid buy without calling the executor', async () => {
  const { executor, calls } = recorder();
  const c = new LocalKeypairCustody({ now: () => 0, paper: true, executor });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'paper-local');
  assert.equal(r.signature, null);
  assert.equal(r.daySpentSol, 0.01);
  assert.equal(calls.length, 0, 'paper mode must NOT sign/send');
});

test('LocalKeypairCustody enforces the same policy codes as MockCustody/signer/vault', async () => {
  const c = new LocalKeypairCustody({ now: () => 0, paper: true, policy: { maxNotionalSol: 0.05, maxDailySol: 0.08, cooldownMs: 0, allow: ['buy'], denyTokens: ['BAD'] } });
  assert.equal((await c.buy('M', 0.1)).code, 'over-trade-cap');
  assert.equal((await c.sell('M', { sizeSol: 0.01 })).code, 'action-not-allowed');
  assert.equal((await c.buy('BAD', 0.01)).code, 'token-denied');
  assert.equal((await c.buy('M', 0.05)).ok, true);
  assert.equal((await c.buy('M', 0.05)).code, 'over-daily-cap');
});

test('LocalKeypairCustody (live) signs locally via the executor → local-trade', async () => {
  const { executor, calls } = recorder({ signature: 'LOCAL_TX', solValue: 0.02 });
  const c = new LocalKeypairCustody({ now: () => 0, paper: false, executor, address: 'MyPubkey' });
  const r = await c.buy('MINT', 0.02);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'local-trade');
  assert.equal(r.signature, 'LOCAL_TX');
  assert.equal(r.txid, 'LOCAL_TX');
  assert.equal(r.submitted, true);
  assert.equal(r.paper, false);
  assert.equal(r.solValue, 0.02);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.intent, { kind: 'buy', token: 'MINT', sizeSol: 0.02 });
});

test('LocalKeypairCustody (live) without an executor rejects with no-executor (never trades blind)', async () => {
  const c = new LocalKeypairCustody({ now: () => 0, paper: false });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no-executor');
});

test('LocalKeypairCustody (live) maps a failure to local-trade-failed AND rolls back the daily budget', async () => {
  const failing: TradeExecutor = { async execute() { throw new Error('slippage exceeded'); } };
  const c = new LocalKeypairCustody({ now: () => 0, paper: false, executor: failing,
    policy: { maxNotionalSol: 0.05, maxDailySol: 0.05, cooldownMs: 0, allow: ['buy'], denyTokens: [] } });
  const r1 = await c.buy('TOK', 0.04);
  assert.equal(r1.code, 'local-trade-failed');
  assert.equal(r1.error, 'slippage exceeded');
  const r2 = await c.buy('TOK', 0.04);
  assert.equal(r2.code, 'local-trade-failed', 'failed trade was rolled back — 2nd buy is not over-daily-cap');
});

test('CircuitAgent selects LocalKeypairCustody when an executor is set and there is no signer', () => {
  const { executor } = recorder();
  class Bot extends CircuitAgent { async tick() {} }
  const bot = new Bot({ executor, context: { signerUrl: '' }, onExit: () => {}, print: () => {} });
  assert.equal(bot.custody.kind, 'local-keypair');
});

test('CircuitAgent still prefers the off-box signer on the mesh even if an executor is passed', () => {
  const { executor } = recorder();
  class Bot extends CircuitAgent { async tick() {} }
  const bot = new Bot({ executor, context: { signerUrl: 'http://signer' }, onExit: () => {}, print: () => {} });
  assert.equal(bot.custody.kind, 'offbox-signer');
});

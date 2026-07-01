import { test } from 'node:test';
import assert from 'node:assert';
import { VaultCustody, type VaultTradeExecutor } from '../src/custody.ts';
import type { Intent } from '../src/types.ts';
import type { VerifiedIntent } from '@circuit-llm/attest';

// A recording executor stands in for the real on-chain path (Jupiter route + VaultClient.trade()).
function recorder(result = { signature: 'SIG_TX', solValue: 0.01 }) {
  const calls: { intent: Intent; vi?: VerifiedIntent }[] = [];
  const executor: VaultTradeExecutor = {
    async execute(intent, vi) {
      calls.push({ intent, vi });
      return result;
    },
  };
  return { executor, calls };
}

test('VaultCustody (paper) paper-signs a valid buy without touching the chain', async () => {
  const { executor, calls } = recorder();
  const c = new VaultCustody({ now: () => 0, paper: true, executor });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'paper-local');
  assert.equal(r.signature, null);
  assert.equal(r.daySpentSol, 0.01);
  assert.equal(calls.length, 0, 'paper mode must NOT call the executor');
});

test('VaultCustody enforces the same policy codes as MockCustody/signer', async () => {
  const c = new VaultCustody({ now: () => 0, paper: true, policy: { maxNotionalSol: 0.05, maxDailySol: 0.08, cooldownMs: 0, allow: ['buy'], denyTokens: ['BAD'] } });
  assert.equal((await c.buy('M', 0.1)).code, 'over-trade-cap');
  assert.equal((await c.sell('M', { sizeSol: 0.01 })).code, 'action-not-allowed');
  assert.equal((await c.buy('BAD', 0.01)).code, 'token-denied');
  assert.equal((await c.buy('M', 0.05)).ok, true);
  assert.equal((await c.buy('M', 0.05)).code, 'over-daily-cap');
});

test('VaultCustody (live) lands a guarded trade on-chain via the executor', async () => {
  const { executor, calls } = recorder({ signature: 'ONCHAIN_TX', solValue: 0.02 });
  const c = new VaultCustody({ now: () => 0, paper: false, executor, address: 'VaultPDA' });
  const r = await c.buy('MINT', 0.02);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'vault-trade');
  assert.equal(r.signature, 'ONCHAIN_TX');
  assert.equal(r.txid, 'ONCHAIN_TX');
  assert.equal(r.submitted, true);
  assert.equal(r.paper, false);
  assert.equal(r.solValue, 0.02);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]!.intent, { kind: 'buy', token: 'MINT', sizeSol: 0.02 });
});

test('VaultCustody (live) without an executor rejects with no-executor (never trades blind)', async () => {
  const c = new VaultCustody({ now: () => 0, paper: false });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'no-executor');
});

test('VaultCustody (live) maps an executor failure to vault-trade-failed without throwing', async () => {
  const executor: VaultTradeExecutor = { async execute() { throw new Error('slippage exceeded'); } };
  const c = new VaultCustody({ now: () => 0, paper: false, executor });
  const r = await c.buy('M', 0.01);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'vault-trade-failed');
  assert.equal(r.error, 'slippage exceeded');
});

test('VaultCustody.verifiedIntent forwards the VerifiedIntent to the executor (so it can attach the oracle attestation)', async () => {
  // No off-chain pre-gate here (the chain is the authoritative Verified-Intents enforcement); this
  // asserts the live path hands the FULL vi to the executor, which builds the Ed25519 attestation.
  const { executor, calls } = recorder({ signature: 'VI_TX', solValue: 0.01 });
  const c = new VaultCustody({ now: () => 0, paper: false, executor });
  const vi: VerifiedIntent = { intent: { kind: 'buy', token: 'MINT', sizeSol: 0.01 }, rule: 'r1', inputs: {}, evidence: [] } as unknown as VerifiedIntent;
  const r = await c.verifiedIntent(vi);
  assert.equal(r.ok, true);
  assert.equal(r.code, 'vault-trade');
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.vi, 'the executor receives the VerifiedIntent');
  assert.equal(calls[0]!.vi?.rule, 'r1');
});

test('VaultCustody (live) rolls back the daily budget when the on-chain trade fails (L1)', async () => {
  const failing: VaultTradeExecutor = { async execute() { throw new Error('rpc down'); } };
  // daily cap = 0.05; two 0.04 buys. WITHOUT rollback the 1st failed buy sticks (0.04) and the 2nd
  // (0.04+0.04=0.08 > 0.05) is rejected over-daily-cap. WITH rollback the 2nd is admitted (then fails).
  const c = new VaultCustody({ now: () => 0, paper: false, executor: failing, address: 'VaultPDA',
    policy: { maxNotionalSol: 0.05, maxDailySol: 0.05, cooldownMs: 0, allow: ['buy'], denyTokens: [] } });
  const r1 = await c.buy('TOK', 0.04);
  assert.equal(r1.code, 'vault-trade-failed');
  const r2 = await c.buy('TOK', 0.04);
  assert.equal(r2.code, 'vault-trade-failed', 'failed trade was rolled back — 2nd buy is not over-daily-cap');
});

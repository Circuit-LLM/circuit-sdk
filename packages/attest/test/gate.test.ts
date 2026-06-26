import { test } from 'node:test';
import assert from 'node:assert';
import { decisionGate, type VerifiedIntent } from '../src/gate.ts';
import { signQuote, signInferenceReceipt, MemoryReplayStore } from '../src/evidence.ts';
import { generateAttestSigner } from '../src/sign.ts';
import type { Rule } from '../src/rule.ts';

const dataSigner = generateAttestSigner();
const infSigner = generateAttestSigner();
const accepted: Record<string, 'data' | 'inference'> = {
  [dataSigner.pubkey]: 'data',
  [infSigner.pubkey]: 'inference',
};

// "buy 0.01 SOL of <mint> when price < 2"
const RULE: Rule = {
  id: 'dip-v1',
  when: [{ input: 'price', op: '<', value: 2 }],
  then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
  requires: ['price'],
};

function genuine(opts: { price?: number; ts?: number; nonce?: string } = {}): VerifiedIntent {
  const price = opts.price ?? 1.8;
  const q = signQuote(dataSigner, {
    path: '/api/token-price?mint=MINT',
    data: { price, mint: 'MINT' },
    ts: opts.ts ?? 1000,
    nonce: opts.nonce ?? 'n1',
  });
  return {
    intent: { kind: 'buy', token: 'MINT', sizeSol: 0.01 },
    rule: 'dip-v1',
    inputs: { price, mint: 'MINT' },
    evidence: [q],
  };
}

const gateOpts = (extra: Record<string, unknown> = {}) => ({
  rule: RULE,
  acceptedKeys: accepted,
  now: () => 1000,
  ...extra,
});

test('a genuine verified intent is accepted', () => {
  assert.deepEqual(decisionGate(genuine(), gateOpts()), { ok: true, code: 'verified' });
});

test('a forged token (host swaps the mint) is rejected — decision-unjustified', () => {
  const vi = genuine();
  vi.intent.token = 'EVIL'; // host wants to buy its own token; the rule produces MINT from inputs
  assert.equal(decisionGate(vi, gateOpts()).code, 'decision-unjustified');
});

test('a forged size (host scales the trade up) is rejected', () => {
  const vi = genuine();
  vi.intent.sizeSol = 1.0; // rule says 0.01
  assert.equal(decisionGate(vi, gateOpts()).code, 'decision-unjustified');
});

test('the host cannot force a trade the market does not justify', () => {
  // genuine, signed price is 2.5 → rule (price < 2) does not fire → no trade is justified
  const vi = genuine({ price: 2.5 });
  assert.equal(decisionGate(vi, gateOpts()).code, 'decision-unjustified');
});

test('faked evidence (tampered after signing) is rejected', () => {
  const vi = genuine();
  (vi.evidence[0] as { data: Record<string, unknown> }).data.price = 0.5; // lie about the price
  assert.equal(decisionGate(vi, gateOpts()).code, 'evidence-invalid');
});

test('lying about inputs (inputs disagree with evidence) is rejected — input-mismatch', () => {
  const vi = genuine();
  vi.inputs.price = 1.0; // claim a different price than the (signed) evidence shows
  assert.equal(decisionGate(vi, gateOpts()).code, 'input-mismatch');
});

test('stale evidence is rejected', () => {
  const vi = genuine({ ts: 1000 });
  assert.equal(decisionGate(vi, gateOpts({ now: () => 1000 + 70_000 })).code, 'evidence-stale');
});

test('replayed evidence (same nonce) is rejected', () => {
  const replay = new MemoryReplayStore();
  const vi = genuine();
  assert.equal(decisionGate(vi, gateOpts({ replay })).ok, true);
  assert.equal(decisionGate(vi, gateOpts({ replay })).code, 'evidence-replay');
});

test('evidence signed by an untrusted key is rejected', () => {
  const rogue = generateAttestSigner();
  const q = signQuote(rogue, { path: '/x', data: { price: 1.8, mint: 'MINT' }, ts: 1000, nonce: 'z' });
  const vi: VerifiedIntent = {
    intent: { kind: 'buy', token: 'MINT', sizeSol: 0.01 },
    rule: 'dip-v1',
    inputs: { price: 1.8, mint: 'MINT' },
    evidence: [q],
  };
  assert.equal(decisionGate(vi, gateOpts()).code, 'evidence-untrusted-key');
});

test('a wrong rule id is rejected', () => {
  const vi = genuine();
  vi.rule = 'other';
  assert.equal(decisionGate(vi, gateOpts()).code, 'unknown-rule');
});

test('signed-AI path: a genuine inference verdict justifies the trade; a faked one does not', () => {
  const aiRule: Rule = {
    id: 'ai-v1',
    when: [{ input: 'aiVerdict', op: '==', value: 'BUY' }],
    then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
    requires: ['aiVerdict'],
  };
  const receipt = signInferenceReceipt(infSigner, {
    inputHash: 'h1',
    outputHash: 'h2',
    verdict: 'BUY',
    modelFp: 'qwen2.5-72b-awq',
    ts: 1000,
    nonce: 'r1',
  });
  const ok: VerifiedIntent = {
    intent: { kind: 'buy', token: 'MINT', sizeSol: 0.01 },
    rule: 'ai-v1',
    inputs: { aiVerdict: 'BUY', mint: 'MINT' },
    evidence: [receipt],
  };
  assert.equal(decisionGate(ok, gateOpts({ rule: aiRule })).ok, true);

  // host claims the model said BUY, but the signed receipt says HOLD
  const lied: VerifiedIntent = { ...ok, inputs: { aiVerdict: 'BUY', mint: 'MINT' }, evidence: [
    signInferenceReceipt(infSigner, { inputHash: 'h1', outputHash: 'h2', verdict: 'HOLD', modelFp: 'm', ts: 1000, nonce: 'r2' }),
  ] };
  assert.equal(decisionGate(lied, gateOpts({ rule: aiRule })).code, 'input-mismatch');
});

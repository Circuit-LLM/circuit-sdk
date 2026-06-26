import { test } from 'node:test';
import assert from 'node:assert';
import { evaluateRule, sameIntent, normalizeRule, type Rule } from '../src/rule.ts';

const RULE: Rule = {
  id: 'dip-v1',
  when: [
    { input: 'price', op: '<', value: 2 },
    { input: 'rsi', op: '<', value: 30 },
  ],
  then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
  requires: ['price', 'rsi'],
};

test('fires when all conditions hold, producing token/size from inputs', () => {
  const i = evaluateRule(RULE, { price: 1.8, rsi: 27, mint: 'MINT' });
  assert.deepEqual(i, { kind: 'buy', token: 'MINT', sizeSol: 0.01 });
});

test('does not fire when any condition fails', () => {
  assert.equal(evaluateRule(RULE, { price: 2.5, rsi: 27, mint: 'MINT' }), null);
  assert.equal(evaluateRule(RULE, { price: 1.8, rsi: 40, mint: 'MINT' }), null);
});

test('== / != work on strings (AI verdicts)', () => {
  const r: Rule = { id: 'ai', when: [{ input: 'v', op: '==', value: 'BUY' }], then: { kind: 'buy', token: 'M' }, requires: ['v'] };
  assert.ok(evaluateRule(r, { v: 'BUY' }));
  assert.equal(evaluateRule(r, { v: 'HOLD' }), null);
});

test('sameIntent compares the trade-relevant fields', () => {
  assert.ok(sameIntent({ kind: 'buy', token: 'M', sizeSol: 0.01 }, { kind: 'buy', token: 'M', sizeSol: 0.01 }));
  assert.equal(sameIntent({ kind: 'buy', token: 'M' }, { kind: 'sell', token: 'M' }), false);
  assert.equal(sameIntent({ kind: 'buy', token: 'M' }, { kind: 'buy', token: 'X' }), false);
});

test('normalizeRule rejects malformed rules', () => {
  assert.throws(() => normalizeRule({ when: [], then: { kind: 'buy' } } as unknown as Rule), /rule.id/);
  assert.throws(() => normalizeRule({ id: 'x', when: [], then: { kind: 'nope' } } as unknown as Rule), /buy\|sell/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CIRCUIT_ACTIONS, circuitActions } from '../src/actions.ts';
import { circuitPlugin } from '../src/eliza.ts';
import { circuitAgentKitActions } from '../src/agent-kit.ts';

test('free tier excludes paid actions', () => {
  const { actions } = circuitActions({ tier: 'free' });
  assert.ok(actions.length > 0);
  assert.ok(actions.every((a) => !a.paid), 'free tier must contain no paid actions');
  assert.ok(actions.some((a) => a.name === 'circuit_token_price'));
});

test('all tier includes paid actions', () => {
  const { actions } = circuitActions({ tier: 'all' });
  assert.equal(actions.length, CIRCUIT_ACTIONS.length);
  assert.ok(actions.some((a) => a.paid), 'all tier must include paid actions');
});

test('eliza plugin shape', () => {
  const p = circuitPlugin({ tier: 'free' });
  assert.equal(p.name, 'circuit');
  assert.ok(Array.isArray(p.actions) && p.actions.length > 0);
  const a = p.actions[0];
  assert.equal(typeof a.name, 'string');
  assert.equal(typeof a.handler, 'function');
  assert.equal(typeof a.validate, 'function');
  assert.ok(Array.isArray(a.similes));
});

test('agent-kit action shape', () => {
  const acts = circuitAgentKitActions({ tier: 'all' });
  assert.ok(acts.length === CIRCUIT_ACTIONS.length);
  const priced = acts.find((a) => a.name === 'CIRCUIT_TOKEN_INFO')!;
  assert.equal(priced.schema.type, 'object');
  assert.deepEqual(priced.schema.required, ['mint']);
  assert.equal(typeof priced.handler, 'function');
});

test('handler returns error object on failure (no throw)', async () => {
  // No wallet configured → a paid call must fail gracefully, not throw.
  const acts = circuitAgentKitActions({ tier: 'all', baseUrl: 'http://127.0.0.1:59999' });
  const info = acts.find((a) => a.name === 'CIRCUIT_TOKEN_INFO')!;
  const res = await info.handler({ mint: 'So11111111111111111111111111111111111111112' });
  assert.equal(res.status, 'error');
  assert.equal(typeof res.message, 'string');
});

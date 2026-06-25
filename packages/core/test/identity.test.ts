import { test } from 'node:test';
import assert from 'node:assert';
import { generateIdentity, signRequest, verifyRequest, stableStringify } from '../src/identity.ts';

test('sign → verify round trip', () => {
  const id = generateIdentity();
  const body = { b: 2, a: 1 };
  const h = signRequest(id, body, 1234);
  assert.equal(h['X-Node-Id'], id.nodeId);
  assert.equal(h['X-Node-Timestamp'], '1234');
  assert.ok(
    verifyRequest(
      { nodeId: h['X-Node-Id'], signature: h['X-Node-Signature'], timestamp: h['X-Node-Timestamp'] },
      body,
    ),
  );
});

test('verify fails on a tampered body', () => {
  const id = generateIdentity();
  const h = signRequest(id, { a: 1 }, 1);
  assert.equal(
    verifyRequest({ nodeId: h['X-Node-Id'], signature: h['X-Node-Signature'], timestamp: '1' }, { a: 2 }),
    false,
  );
});

test('verify fails with the wrong public key', () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const h = signRequest(a, { x: 1 }, 5);
  assert.equal(
    verifyRequest({ nodeId: b.nodeId, signature: h['X-Node-Signature'], timestamp: '5' }, { x: 1 }),
    false,
  );
});

test('stableStringify sorts keys recursively', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});

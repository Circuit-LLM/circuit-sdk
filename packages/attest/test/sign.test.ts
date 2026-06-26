import { test } from 'node:test';
import assert from 'node:assert';
import {
  generateAttestSigner,
  attestSignerFromSeed,
  signPayload,
  verifyPayload,
} from '../src/sign.ts';

test('sign → verify round trip', () => {
  const s = generateAttestSigner();
  const payload = { b: 2, a: 1, nested: { y: 2, x: 1 } };
  const sig = signPayload(s, payload);
  assert.ok(verifyPayload(s.pubkey, payload, sig));
});

test('verify fails on a tampered payload', () => {
  const s = generateAttestSigner();
  const sig = signPayload(s, { price: 1.8 });
  assert.equal(verifyPayload(s.pubkey, { price: 0.5 }, sig), false);
});

test('verify fails with the wrong key', () => {
  const a = generateAttestSigner();
  const b = generateAttestSigner();
  const sig = signPayload(a, { x: 1 });
  assert.equal(verifyPayload(b.pubkey, { x: 1 }, sig), false);
});

test('seed round-trips to the same signer', () => {
  const s = generateAttestSigner();
  const s2 = attestSignerFromSeed(s.seedHex);
  assert.equal(s2.pubkey, s.pubkey);
  const sig = signPayload(s2, { a: 1 });
  assert.ok(verifyPayload(s.pubkey, { a: 1 }, sig));
});

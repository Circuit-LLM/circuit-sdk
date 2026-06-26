import { test } from 'node:test';
import assert from 'node:assert';
import {
  generateMeshIdentity,
  meshIdentityFromSeed,
  signMeshBody,
  verifyMeshBody,
} from '../src/mesh-identity.ts';

test('mesh identity: nodeId is a 64-hex raw pubkey; seed reconstructs the same id', () => {
  const id = generateMeshIdentity();
  assert.match(id.nodeId, /^[0-9a-f]{64}$/);
  assert.match(id.seedHex, /^[0-9a-f]{64}$/);
  assert.equal(meshIdentityFromSeed(id.seedHex).nodeId, id.nodeId);
});

test('signMeshBody stamps node_id + ts + sig and verifies', () => {
  const id = generateMeshIdentity();
  const signed = signMeshBody(id, { endpoint: ['h', 5000], capacity_layers: 40 }, 1234);
  assert.equal(signed.node_id, id.nodeId);
  assert.equal(signed.ts, 1234);
  assert.match(signed.sig as string, /^[0-9a-f]+$/);
  assert.equal(verifyMeshBody(signed), true);
});

test('verifyMeshBody fails on a tampered body', () => {
  const id = generateMeshIdentity();
  const signed = signMeshBody(id, { capacity_layers: 40 }, 1);
  (signed as Record<string, unknown>).capacity_layers = 80;
  assert.equal(verifyMeshBody(signed), false);
});

test('meshIdentityFromSeed rejects a bad seed length', () => {
  assert.throws(() => meshIdentityFromSeed('abcd'), /32 bytes/);
});

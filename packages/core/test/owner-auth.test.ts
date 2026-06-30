import { test } from 'node:test';
import assert from 'node:assert';
import { ownerAuthHeaders, verifyOwnerRequest, NonceStore } from '../src/owner-auth.ts';

// ── Golden cross-impl vector ────────────────────────────────────────────────────────────────────
// Computed from circuit-agent-cloud/lib/owner-auth.js (the authoritative verifier the control plane
// runs). If this drifts, requests the SDK signs are rejected by the CP. Seed = 32×0x07; the 64-byte
// Solana secret is seed‖pubkey.
const SECRETKEY = Buffer.from(
  'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwfqSmxj4pxSCr71UHsTLsX5lUd2rr6+e5JCHuppFEbSLA==',
  'base64',
);
const ADDRESS = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';
const GOLDEN_SIG = '4zMMrarMNFTwc6BcS4QPGYUAsg3LArx1GYkDP9pFvCKrcdN1nAeFgwf5niUoYNrkfGjEtif8aHneL4QZrAfzsfuA';
const signer = { secretKey: SECRETKEY, address: ADDRESS };
const REQ = { method: 'POST', path: '/v1/agents/agent-x/withdraw', body: { amountSol: 0.1 } };
const TS = 1700000000000;

test('ownerAuthHeaders matches the cloud signature (and strips the query string)', () => {
  // pass a query — it must be stripped (the CP verifies the pathname only), so the sig still matches
  const h = ownerAuthHeaders('POST', '/v1/agents/agent-x/withdraw?foo=1', REQ.body, signer, { ts: TS, nonce: 'GoldenNonce11' });
  assert.equal(h['X-Circuit-Sig'], GOLDEN_SIG, 'signature is byte-identical to the cloud verifier');
  assert.equal(h['X-Circuit-Owner'], ADDRESS);
  assert.equal(h['X-Circuit-Ts'], String(TS));
  assert.equal(h['X-Circuit-Nonce'], 'GoldenNonce11');
});

test('verifyOwnerRequest accepts a genuine request and rejects tampering', () => {
  const headers = ownerAuthHeaders('POST', REQ.path, REQ.body, signer, { ts: TS, nonce: 'n1' });
  const now = () => TS;

  assert.equal(verifyOwnerRequest({ ...REQ, headers }, { now }), ADDRESS, 'genuine request authenticates as the owner');
  // tampered body → bad signature
  assert.throws(() => verifyOwnerRequest({ ...REQ, body: { amountSol: 9.9 }, headers }, { now }), /bad signature/);
  // tampered path → bad signature
  assert.throws(() => verifyOwnerRequest({ ...REQ, path: '/v1/agents/OTHER/withdraw', headers }, { now }), /bad signature/);
  // stale timestamp
  assert.throws(() => verifyOwnerRequest({ ...REQ, headers }, { now: () => TS + 60_000 }), /stale/);
});

test('an unsigned request returns null (caller decides if that is allowed)', () => {
  assert.equal(verifyOwnerRequest({ method: 'GET', path: '/v1/agents', headers: {} }), null);
  // header lookup is case-insensitive (proxies lowercase headers)
  const headers = ownerAuthHeaders('POST', REQ.path, REQ.body, signer, { ts: TS, nonce: 'n2' });
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  assert.equal(verifyOwnerRequest({ ...REQ, headers: lower }, { now: () => TS }), ADDRESS);
});

test('the nonce store blocks replay', () => {
  // NonceStore tracks expiry against the real clock (like the cloud), so use a real-time ts here.
  const headers = ownerAuthHeaders('POST', REQ.path, REQ.body, signer, { nonce: 'replay-me' });
  const nonceStore = new NonceStore();
  assert.equal(verifyOwnerRequest({ ...REQ, headers }, { nonceStore }), ADDRESS, 'first use ok');
  assert.throws(() => verifyOwnerRequest({ ...REQ, headers }, { nonceStore }), /replay/, 'second use rejected');
});

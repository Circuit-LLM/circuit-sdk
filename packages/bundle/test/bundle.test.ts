import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fromSeed, base58 } from '../src/crypto.ts';
import {
  manifestSigningBytes,
  signManifest,
  verifyManifest,
  createBundle,
  verifyBundle,
  isSafeEntry,
  packDir,
  unpackTo,
  type BundleManifest,
} from '../src/bundle.ts';

// ── Golden cross-impl vector ────────────────────────────────────────────────────────────
// Computed from circuit-agent-cloud/lib/ed25519.js (the authoritative impl). If any of these
// assertions fail, this SDK's signing has DRIFTED from the cloud/CLI and bundles signed here
// will be rejected by the node-host. This is the contract — do not "fix" it by editing the
// expectations; fix the codec.
const SEED = Buffer.alloc(32, 7);
const GOLDEN_ADDR = 'GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB';
const GOLDEN_SIGNING_BYTES =
  '{"agentId":"agent-x","egress":["a.com","b.com"],"entry":"agent.js","resources":{"maxCpu":2,"maxMemoryMb":512},"runtime":"node","schema":1,"sdk":"0.1.0","sha256":"abc123"}';
const GOLDEN_SIG =
  '5Zra33ajrvziJ295VZKn65DVvhnaq3vJmrbGbe9XVM47cGX8UfFDeAVmSt1YRwSjMHNg1kSJsNydKELrPvFKFNyP';

const goldenManifest = (): BundleManifest => ({
  schema: 1,
  agentId: 'agent-x',
  runtime: 'node',
  entry: 'agent.js',
  sdk: '0.1.0',
  egress: ['b.com', 'a.com'], // intentionally unsorted — canonicalization must sort
  resources: { maxCpu: 2, maxMemoryMb: 512 },
  sha256: 'abc123',
  publisherPubkey: GOLDEN_ADDR,
});

test('fromSeed derives the canonical Solana address', () => {
  assert.equal(fromSeed(SEED).address, GOLDEN_ADDR);
});

test('manifestSigningBytes is canonical (sorted keys + sorted egress)', () => {
  assert.equal(manifestSigningBytes(goldenManifest()).toString(), GOLDEN_SIGNING_BYTES);
});

test('signManifest matches the cross-impl golden signature', () => {
  const kp = fromSeed(SEED);
  assert.equal(signManifest(goldenManifest(), kp.priv), GOLDEN_SIG);
});

test('verifyManifest accepts a good sig and rejects tampering', () => {
  const m = goldenManifest();
  m.sig = GOLDEN_SIG;
  assert.equal(verifyManifest(m), true);

  // tamper with a signed field → sig no longer covers it
  const tampered = { ...m, egress: ['evil.com'] };
  assert.equal(verifyManifest(tampered), false);

  // missing sig / pubkey
  assert.equal(verifyManifest({ ...m, sig: undefined }), false);
  assert.equal(verifyManifest({ ...m, publisherPubkey: '' }), false);
});

test('isSafeEntry blocks path escapes', () => {
  assert.equal(isSafeEntry('agent.js'), true);
  assert.equal(isSafeEntry('my-agent.mjs'), true);
  assert.equal(isSafeEntry('..'), false);
  assert.equal(isSafeEntry('.'), false);
  assert.equal(isSafeEntry('a/b.js'), false);
  assert.equal(isSafeEntry('/etc/passwd'), false);
  assert.equal(isSafeEntry(42 as unknown), false);
});

test('verifyBundle enforces sha256, sig, owner, agentId, entry', () => {
  const bytes = Buffer.from('hello bundle bytes');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const kp = fromSeed(SEED);
  const m: BundleManifest = {
    schema: 1,
    agentId: 'agent-1',
    runtime: 'node',
    entry: 'agent.js',
    sdk: null,
    egress: [],
    resources: null,
    sha256: sha,
    publisherPubkey: kp.address,
  };
  m.sig = signManifest(m, kp.priv);

  assert.deepEqual(verifyBundle(bytes, m), { ok: true });
  assert.deepEqual(verifyBundle(Buffer.from('other'), m), { ok: false, code: 'sha256-mismatch' });
  assert.deepEqual(verifyBundle(bytes, { ...m, sig: undefined }), { ok: false, code: 'bad-manifest-sig' });
  assert.deepEqual(verifyBundle(bytes, m, { expectedOwner: 'someone-else' }), { ok: false, code: 'publisher-not-owner' });
  assert.deepEqual(verifyBundle(bytes, m, { expectedAgentId: 'other-agent' }), { ok: false, code: 'agent-id-mismatch' });
  assert.deepEqual(verifyBundle(bytes, m, { expectedOwner: kp.address, expectedAgentId: 'agent-1' }), { ok: true });
});

test('createBundle → verifyBundle → unpackTo round-trips the agent', () => {
  const kp = fromSeed(crypto.randomBytes(32));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'cbundle-src-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cbundle-dst-'));
  try {
    fs.writeFileSync(path.join(src, 'agent.js'), 'console.log("hi from agent")\n');
    const { bytes, sha256, manifest } = createBundle({
      dir: src,
      agentId: 'agent-roundtrip',
      sdk: '0.0.0',
      egress: ['api.example.com'],
      priv: kp.priv,
      publisherPubkey: kp.address,
    });
    assert.equal(manifest.sha256, sha256);
    assert.deepEqual(verifyBundle(bytes, manifest, { expectedOwner: kp.address, expectedAgentId: 'agent-roundtrip' }), {
      ok: true,
    });
    unpackTo(bytes, dst);
    assert.equal(fs.readFileSync(path.join(dst, 'agent.js'), 'utf8'), 'console.log("hi from agent")\n');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dst, { recursive: true, force: true });
  }
});

test('packDir is content-addressed (sha256 over deterministic tar metadata)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cbundle-pack-'));
  try {
    fs.writeFileSync(path.join(dir, 'agent.js'), 'x');
    const a = packDir(dir);
    assert.match(a.sha256, /^[0-9a-f]{64}$/);
    assert.ok(a.bytes.length > 0);
    // base58 of the sha bytes is a separate encoding path; just sanity-check it runs
    assert.ok(base58(Buffer.from(a.sha256.slice(0, 16), 'hex')).length > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

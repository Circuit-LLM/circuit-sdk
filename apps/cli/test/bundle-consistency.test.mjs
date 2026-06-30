// Cross-repo lock: a bundle the CLI publishes MUST verify under circuit-agent-cloud's real verifier
// (same canonical signing bytes, Ed25519, base58, sha256). If this drifts, nodes reject CLI bundles.
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const kp = Keypair.generate();
process.env.CIRCUIT_WALLET = bs58.encode(kp.secretKey);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-bundle-'));
process.env.CIRCUIT_BUNDLE_STORE = path.join(tmp, 'store');
const srcDir = path.join(tmp, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'agent.js'), 'console.log("hi")');

const { publishDir } = await import('../src/services/bundle.js');
const { verifyBundle } = await import('/home/watchtower/circuit-agent-cloud/lib/bundle.js');

const b = publishDir({ dir: srcDir, agentId: 'x', entry: 'agent.js', sdk: '@circuit/agent@0' });
assert.equal(b.manifest.publisherPubkey, kp.publicKey.toBase58(), 'publisher == wallet');
const bytes = fs.readFileSync(b.url);

// the real cloud verifier accepts the CLI-published bundle for its owner …
assert.deepEqual(verifyBundle(bytes, b.manifest, { expectedOwner: kp.publicKey.toBase58() }), { ok: true });
// … and rejects it for anyone else
assert.equal(verifyBundle(bytes, b.manifest, { expectedOwner: Keypair.generate().publicKey.toBase58() }).code, 'publisher-not-owner');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('CLI↔cloud bundle consistency: PASS');

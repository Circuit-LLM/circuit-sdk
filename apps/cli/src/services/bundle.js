// services/bundle.js — publish an agent as a content-addressed, signed bundle (AGENT_BUNDLES.md §2-3).
//
// The whole codec — the cross-platform USTAR packer, secret-file exclusion, and the canonical manifest
// signing — now lives in @circuit/bundle, ONE source of truth across the CLI, the SDK, and
// circuit-agent-cloud (so a bundle the CLI publishes always verifies on a node; locked by
// bundle-consistency.test.mjs). This file is just the CLI's publish UX: load the wallet, call
// createBundle, and drop the result in the local content-addressed store.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBundle, fromSeed, manifestSigningBytes, BUNDLE_SCHEMA } from '@circuit/bundle';
import { loadKeypair } from './solana.js';

export { manifestSigningBytes, BUNDLE_SCHEMA };

// The local content-addressed store (B1 own-fleet backend). On a shared fs the node reads it directly;
// a real deployment swaps in object storage / a CDN behind the same {sha}.tgz / {sha}.manifest.json shape.
export function storeRoot() {
  return process.env.CIRCUIT_BUNDLE_STORE || path.join(os.homedir(), '.circuit', 'bundles');
}

/**
 * Build + sign + store a bundle from a source directory.
 * @returns {{ ref, url, sha256, runtime, manifest, fileCount, excludedSecrets }} the bundle block + report.
 */
export function publishDir({ dir, agentId, entry = 'agent.js', sdk = null, runtime = 'node', egress = [], resources = null }) {
  const kp = loadKeypair();
  if (!kp) throw new Error('no wallet — set a Circuit wallet to publish (the publisher must be the agent owner)');

  // createBundle validates runtime/entry, packs (cross-platform, secrets excluded), and signs the manifest
  // with the owner's wallet key (publisher MUST be the agent owner — the control plane re-checks at bind).
  const { bytes, sha256, manifest, files, excludedSecrets } = createBundle({
    dir, agentId, entry, sdk, runtime, egress, resources,
    priv: fromSeed(Buffer.from(kp.secretKey.slice(0, 32))).priv,
    publisherPubkey: kp.publicKey.toBase58(),
  });

  const root = storeRoot();
  fs.mkdirSync(root, { recursive: true });
  const tgz = path.join(root, `${sha256}.tgz`);
  fs.writeFileSync(tgz, bytes);
  fs.writeFileSync(path.join(root, `${sha256}.manifest.json`), JSON.stringify(manifest));
  // fileCount + excludedSecrets let the caller show what shipped and what was deliberately held back
  // (secrets never go in the bundle — the owner injects them as runtime env on the node).
  return { ref: `bundle://${sha256}`, url: tgz, sha256, runtime, manifest, fileCount: files.length, excludedSecrets };
}

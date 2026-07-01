// Mesh control-plane identity + signing. The inference mesh (circuit-dllm
// engine/control_server.py) uses a DIFFERENT scheme from the node registry: the
// node_id is the RAW ed25519 public key as hex (64 chars), and a request is signed
// by stamping {node_id, ts} into the body and signing the compact, key-sorted JSON
// of the body-minus-sig. This module reproduces exactly that (verified against
// make_ed25519_signer / make_ed25519_verifier).

import crypto from 'node:crypto';
import { stableStringify } from '@circuit-llm/core';

// DER wrappers for a raw 32-byte ed25519 key.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // + 32-byte seed
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // + 32-byte pubkey

export interface MeshIdentity {
  /** raw ed25519 public key, hex (this IS the node_id). */
  nodeId: string;
  /** raw ed25519 seed, hex (32 bytes) — for persistence. */
  seedHex: string;
  /** private KeyObject — for signing. */
  privateKey: crypto.KeyObject;
}

function rawPubHex(pub: crypto.KeyObject): string {
  const der = pub.export({ type: 'spki', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32)).toString('hex');
}
function rawSeedHex(priv: crypto.KeyObject): string {
  const der = priv.export({ type: 'pkcs8', format: 'der' });
  return Buffer.from(der.subarray(der.length - 32)).toString('hex');
}

export function generateMeshIdentity(): MeshIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { nodeId: rawPubHex(publicKey), seedHex: rawSeedHex(privateKey), privateKey };
}

/** Reconstruct a mesh identity from its 32-byte seed (hex). */
export function meshIdentityFromSeed(seedHex: string): MeshIdentity {
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) throw new Error('ed25519 seed must be 32 bytes (64 hex chars)');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return { nodeId: rawPubHex(crypto.createPublicKey(privateKey)), seedHex, privateKey };
}

/** Stamp {node_id, ts} and attach an ed25519 `sig` over the compact sorted JSON of
 *  the body-minus-sig. `now` (unix seconds) is injectable for tests. */
export function signMeshBody(
  identity: MeshIdentity,
  body: Record<string, unknown>,
  now: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const stamped = { ...body, node_id: identity.nodeId, ts: now };
  const sig = crypto.sign(null, Buffer.from(stableStringify(stamped)), identity.privateKey).toString('hex');
  return { ...stamped, sig };
}

/** Server-side counterpart — verify a signed mesh body. */
export function verifyMeshBody(body: Record<string, unknown>): boolean {
  try {
    const sig = String(body.sig);
    const nodeId = String(body.node_id);
    const pub = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(nodeId, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    const rest: Record<string, unknown> = { ...body };
    delete rest.sig;
    return crypto.verify(null, Buffer.from(stableStringify(rest)), pub, Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

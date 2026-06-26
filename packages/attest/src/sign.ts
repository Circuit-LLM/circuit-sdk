// Attestation signing — ed25519 over canonical (key-sorted, compact) JSON. The public
// key is the raw 32-byte ed25519 key, hex-encoded (same scheme @circuit/node uses for
// the mesh, so an inference receipt signed by a mesh node verifies here unchanged).
// First-party producers (the data API, the inference gateway) sign their responses with
// this; the agent and the signer verify with it.

import crypto from 'node:crypto';
import { stableStringify } from '@circuit/core';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // + 32-byte seed
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // + 32-byte pubkey

export interface AttestSigner {
  /** raw ed25519 public key, hex (the producer's published key id). */
  pubkey: string;
  /** raw ed25519 seed, hex — for persistence. */
  seedHex: string;
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

export function generateAttestSigner(): AttestSigner {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return { pubkey: rawPubHex(publicKey), seedHex: rawSeedHex(privateKey), privateKey };
}

export function attestSignerFromSeed(seedHex: string): AttestSigner {
  const seed = Buffer.from(seedHex, 'hex');
  if (seed.length !== 32) throw new Error('ed25519 seed must be 32 bytes (64 hex chars)');
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, seed]),
    format: 'der',
    type: 'pkcs8',
  });
  return { pubkey: rawPubHex(crypto.createPublicKey(privateKey)), seedHex, privateKey };
}

/** Sign the canonical encoding of `payload`; returns the signature hex. */
export function signPayload(signer: AttestSigner, payload: unknown): string {
  return crypto.sign(null, Buffer.from(stableStringify(payload)), signer.privateKey).toString('hex');
}

/** Verify `sigHex` over `payload` against the raw-hex public key. */
export function verifyPayload(pubkeyHex: string, payload: unknown, sigHex: string): boolean {
  try {
    const pub = crypto.createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubkeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(stableStringify(payload)), pub, Buffer.from(sigHex, 'hex'));
  } catch {
    return false;
  }
}

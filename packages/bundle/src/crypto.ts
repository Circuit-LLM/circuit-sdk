// Ed25519 + base58 + sha256, ported BYTE-FOR-BYTE from circuit-agent-cloud/lib/ed25519.js.
//
// The bundle signature is a CROSS-IMPLEMENTATION CONTRACT: a manifest signed by circuit-cli must
// verify in circuit-agent-cloud's node-host and here, and vice versa. Do not "improve" these
// encodings — the base58 alphabet, the PKCS8/SPKI DER framing, and `crypto.sign(null, …)` (native
// Ed25519) must all stay identical, or signatures silently stop matching across the three impls.
//
// Solana keypairs ARE Ed25519, so `fromSeed` produces a real, fundable Solana address. Zero deps
// beyond node:crypto.
import crypto from 'node:crypto';

// Fixed DER framings for Ed25519 (RFC 8410). The key bytes are the tail.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // 16B + 32B seed
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); //          12B + 32B pubkey

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = Object.fromEntries([...B58].map((ch, i) => [ch, i]));

export function base58(buf: Uint8Array | Buffer): string {
  const bytes = Uint8Array.from(buf);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = []; // big-endian base-58 of the non-zero portion
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!; // i < bytes.length → defined
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros); // one '1' per leading zero byte
  for (let k = digits.length - 1; k >= 0; k--) out += B58[digits[k]!]!;
  return out;
}

export function base58decode(str: string): Buffer {
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  const bytes: number[] = [];
  for (let i = zeros; i < str.length; i++) {
    let carry: number | undefined = B58_MAP[str[i]!];
    if (carry === undefined) throw new Error(`invalid base58 char '${str[i]}'`);
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j]! * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = Buffer.alloc(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + bytes.length - 1 - i] = bytes[i]!;
  return out;
}

export interface Keypair {
  seed: Buffer;
  priv: crypto.KeyObject;
  pubkey: Buffer; // 32-byte raw Ed25519 public key
  address: string; // base58 of pubkey (the Solana address)
}

/** Deterministic keypair from a 32-byte seed. */
export function fromSeed(seed: Uint8Array | Buffer): Keypair {
  if (seed.length !== 32) throw new Error('seed must be 32 bytes');
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const pubkey = Buffer.from(spki.subarray(spki.length - 32));
  return { seed: Buffer.from(seed), priv, pubkey, address: base58(pubkey) };
}

export function newKeypair(): Keypair {
  return fromSeed(crypto.randomBytes(32));
}

/** 64-byte Ed25519 signature over `msg`. `priv` is a node KeyObject (see fromSeed). */
export function sign(priv: crypto.KeyObject, msg: Uint8Array | Buffer): Buffer {
  return crypto.sign(null, Buffer.from(msg), priv); // null algo == Ed25519
}

/** Verify a signature against a 32-byte raw Ed25519 public key. */
export function verify(pubkey: Uint8Array | Buffer, msg: Uint8Array | Buffer, sig: Uint8Array | Buffer): boolean {
  const pub = crypto.createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubkey)]),
    format: 'der',
    type: 'spki',
  });
  return crypto.verify(null, Buffer.from(msg), pub, Buffer.from(sig));
}

export const sha256hex = (s: crypto.BinaryLike): string => crypto.createHash('sha256').update(s).digest('hex');

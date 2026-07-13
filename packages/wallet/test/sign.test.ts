import { test } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { Wallet } from '../src/wallet.ts';

// Ed25519 SPKI DER framing — wraps a raw 32-byte pubkey so node:crypto can verify against it.
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// The gateway verifies with tweetnacl's `nacl.sign.detached.verify(msg, sig, pubkey)`. Ed25519 raw
// signatures are interoperable, so node:crypto verifying here proves the gateway would accept it too.
function verifyDetached(pubkey: Uint8Array, msg: Uint8Array, sigB58: string): boolean {
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubkey)]), format: 'der', type: 'spki' });
  return crypto.verify(null, Buffer.from(msg), pub, bs58.decode(sigB58));
}

test('signMessage produces a base58 Ed25519 signature that verifies against the wallet pubkey', () => {
  const kp = Keypair.generate();
  const w = new Wallet({ keypair: kp });
  const msg = `Circuit Models\nwallet:${w.address}\nts:${1_700_000_000_000}`;
  const sig = w.signMessage(msg);
  assert.ok(verifyDetached(kp.publicKey.toBytes(), new TextEncoder().encode(msg), sig));
  // A tampered message must not verify with the same signature.
  assert.equal(verifyDetached(kp.publicKey.toBytes(), new TextEncoder().encode(msg + 'x'), sig), false);
});

test('signMessage throws in read-only mode', () => {
  const w = new Wallet({ address: 'So11111111111111111111111111111111111111112' });
  assert.throws(() => w.signMessage('x'), /No wallet loaded/);
});

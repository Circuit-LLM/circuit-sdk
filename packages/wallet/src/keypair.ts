// Keypair loading/parsing. Ported from circuit-cli/src/services/solana.js.

import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

/** Parse a secret key from base58, a JSON byte-array string, an array, or raw bytes. */
export function keypairFromSecret(input: string | number[] | Uint8Array): Keypair {
  if (input instanceof Uint8Array) return Keypair.fromSecretKey(input);
  if (Array.isArray(input)) return Keypair.fromSecretKey(Uint8Array.from(input));
  const s = String(input).trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s) as number[]));
  return Keypair.fromSecretKey(bs58.decode(s));
}

/** Load the signing keypair from the CIRCUIT_WALLET env var; null if unset. */
export function loadKeypairFromEnv(env: NodeJS.ProcessEnv = process.env): Keypair | null {
  const v = env.CIRCUIT_WALLET;
  if (!v) return null;
  try {
    return keypairFromSecret(v.trim());
  } catch {
    throw new Error('CIRCUIT_WALLET is set but is not a valid base58/array secret key');
  }
}

export function generateKeypair(): Keypair {
  return Keypair.generate();
}

export const secretKeyBase58 = (kp: Keypair): string => bs58.encode(kp.secretKey);

export function isValidAddress(s: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

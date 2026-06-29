// services/owner-auth.js — sign control-plane requests with the wallet (owner) key.
//
// The canonical message + Ed25519 MUST stay byte-identical to circuit-agent-cloud/lib/owner-auth.js
// (locked by a cross-repo test). The control plane verifies the signature against the agent owner and
// authorizes per-agent, so a multi-tenant CP can tell tenants apart without holding any per-user secret.
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { loadKeypair } from './solana.js';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // Ed25519 PKCS8 framing
const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// deterministic JSON (sorted keys) — identical to the cloud's stableStringify
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function ownerAuthMessage({ method, path, body, ts, nonce }) {
  const bodyHash = sha256hex(stableStringify(body ?? {}));
  return `circuit-owner-auth\nv1\n${String(method).toUpperCase()}\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
}

/** Headers that authenticate this request as the wallet owner — or {} if no wallet is set (own-fleet). */
export function ownerAuthHeaders(method, fullPath, body) {
  const kp = loadKeypair();
  if (!kp) return {};
  const path = String(fullPath).split('?')[0]; // sign the pathname only (the CP verifies pathname)
  const ts = Date.now();
  const nonce = bs58.encode(crypto.randomBytes(12));
  const seed = Buffer.from(kp.secretKey.slice(0, 32));
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const sig = crypto.sign(null, Buffer.from(ownerAuthMessage({ method, path, body, ts, nonce })), priv);
  return {
    'X-Circuit-Owner': kp.publicKey.toBase58(),
    'X-Circuit-Ts': String(ts),
    'X-Circuit-Nonce': nonce,
    'X-Circuit-Sig': bs58.encode(sig),
  };
}

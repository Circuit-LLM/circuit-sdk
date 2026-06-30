// Per-owner request authentication for the multi-tenant control plane. Ported BYTE-IDENTICAL from
// circuit-agent-cloud/lib/owner-auth.js (and circuit-cli/src/services/owner-auth.js): each mutating
// request is signed by the agent OWNER's wallet (Ed25519, the same key that is the sole withdraw
// authority). The control plane verifies the signature + freshness + a one-time nonce, then authorizes
// per-agent — replacing "one shared bearer can do anything" (an IDOR) with real per-owner auth. The
// server holds no per-user secret: identity IS the wallet pubkey.
//
// The canonical message + Ed25519 + base58 MUST stay byte-identical across the CLI, the cloud, and here
// (golden vector in test/owner-auth.test.ts). The base58/ed25519 helpers mirror @circuit/bundle's crypto;
// consolidating both into one core crypto module is a tracked follow-on.
import crypto from 'node:crypto';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex'); // Ed25519 PKCS8 framing
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP: Record<string, number> = Object.fromEntries([...B58].map((ch, i) => [ch, i]));

function base58(buf: Uint8Array | Buffer): string {
  const bytes = Uint8Array.from(buf);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
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
  let out = '1'.repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k--) out += B58[digits[k]!]!;
  return out;
}

function base58decode(str: string): Buffer {
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

const sha256hex = (s: crypto.BinaryLike): string => crypto.createHash('sha256').update(s).digest('hex');
function signSeed(seed32: Uint8Array, msg: Buffer): Buffer {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed32)]), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, msg, priv);
}
function verifyRaw(pubkey: Uint8Array | Buffer, msg: Buffer, sig: Uint8Array | Buffer): boolean {
  const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(pubkey)]), format: 'der', type: 'spki' });
  return crypto.verify(null, msg, pub, Buffer.from(sig));
}

// Deterministic JSON (sorted keys, recursive) so client and server hash the SAME bytes for a body.
// Internal (not exported) — core's public stableStringify lives in identity.ts; this copy is kept beside
// ownerAuthMessage to guarantee the byte-identity contract can't drift if that one ever changes.
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

// The exact bytes signed: method, path, a hash of the canonical body, the timestamp, and the nonce.
export function ownerAuthMessage({ method, path, body, ts, nonce }: { method: string; path: string; body?: unknown; ts: number | string; nonce: string }): string {
  const bodyHash = sha256hex(stableStringify(body ?? {}));
  return `circuit-owner-auth\nv1\n${String(method).toUpperCase()}\n${path}\n${bodyHash}\n${ts}\n${nonce}`;
}

/** A Solana-style owner key: the 64-byte secret + the base58 address (e.g. from @circuit/wallet). */
export interface OwnerSigner {
  secretKey: Uint8Array; // 64-byte Solana secret (seed‖pubkey); only the 32-byte seed is used to sign
  address: string; // base58 pubkey
}

/** Headers that authenticate a request as the wallet owner. `fullPath` may include a query (stripped — the
 *  CP verifies the pathname only). Pass `ts`/`nonce` only for deterministic tests. */
export function ownerAuthHeaders(
  method: string,
  fullPath: string,
  body: unknown,
  signer: OwnerSigner,
  opts: { ts?: number; nonce?: string } = {},
): Record<string, string> {
  const path = String(fullPath).split('?')[0]!;
  const ts = opts.ts ?? Date.now();
  const nonce = opts.nonce ?? base58(crypto.randomBytes(12));
  const sig = signSeed(signer.secretKey.slice(0, 32), Buffer.from(ownerAuthMessage({ method, path, body, ts, nonce })));
  return {
    'X-Circuit-Owner': signer.address,
    'X-Circuit-Ts': String(ts),
    'X-Circuit-Nonce': nonce,
    'X-Circuit-Sig': base58(sig),
  };
}

export interface NonceCache {
  has(nonce: string): boolean;
  add(nonce: string, expiry: number): void;
}

class OwnerAuthError extends Error {
  readonly status = 401;
}

/** Verify a signed request. Returns the authenticated owner pubkey, or null if NO owner headers are
 *  present (the caller decides if that's allowed). Throws (status 401) on a present-but-invalid sig,
 *  stale timestamp, or replayed nonce. */
export function verifyOwnerRequest(
  { method, path, body, headers }: { method: string; path: string; body?: unknown; headers: Record<string, string | undefined> },
  { maxAgeMs = 30_000, nonceStore, now = Date.now }: { maxAgeMs?: number; nonceStore?: NonceCache; now?: () => number } = {},
): string | null {
  const h = (k: string): string | undefined => headers[k] ?? headers[k.toLowerCase()];
  const owner = h('X-Circuit-Owner');
  const ts = h('X-Circuit-Ts');
  const nonce = h('X-Circuit-Nonce');
  const sig = h('X-Circuit-Sig');
  if (!owner && !ts && !nonce && !sig) return null; // unsigned request
  const fail = (m: string): never => { throw new OwnerAuthError(`owner auth: ${m}`); };
  if (!owner || !ts || !nonce || !sig) return fail('incomplete signature headers');
  const tsn = Number(ts);
  if (!Number.isFinite(tsn) || Math.abs(now() - tsn) > maxAgeMs) return fail('stale or invalid timestamp');
  if (nonceStore) {
    if (nonceStore.has(nonce)) return fail('nonce replay');
    nonceStore.add(nonce, tsn + maxAgeMs);
  }
  let ok = false;
  try { ok = verifyRaw(base58decode(owner), Buffer.from(ownerAuthMessage({ method, path, body, ts: tsn, nonce })), base58decode(sig)); }
  catch { return fail('malformed signature'); }
  if (!ok) return fail('bad signature');
  return owner;
}

// Tiny TTL nonce cache (single-process). A multi-process CP needs a shared store, but the freshness
// window already bounds replay to maxAgeMs even without it.
export class NonceStore implements NonceCache {
  private readonly m = new Map<string, number>();
  has(n: string): boolean {
    const e = this.m.get(n);
    if (e && e > Date.now()) return true;
    if (e) this.m.delete(n);
    return false;
  }
  add(n: string, expiry: number): void {
    this.m.set(n, expiry);
    if (this.m.size > 5000) for (const [k, v] of this.m) if (v <= Date.now()) this.m.delete(k);
  }
}

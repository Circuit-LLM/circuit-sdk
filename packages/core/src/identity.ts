// Node/agent identity — a persistent ed25519 keypair whose public key IS the id.
// Outbound requests to the registry are signed so the server can verify authenticity.
// Ported from circuit-node-client/lib/identity.js, made dependency-injectable (no
// implicit filesystem — file helpers are opt-in at the bottom).

import crypto from 'node:crypto';

export interface Identity {
  /** base64 SPKI/DER public key — this IS the node id. */
  nodeId: string;
  publicKeyB64: string;
  privateKeyB64: string;
  createdAt?: string;
}

/** Generate a fresh ed25519 identity (SPKI/PKCS8 DER, base64-encoded). */
export function generateIdentity(): Identity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  const publicKeyB64 = publicKey.toString('base64');
  return {
    nodeId: publicKeyB64,
    publicKeyB64,
    privateKeyB64: privateKey.toString('base64'),
    createdAt: new Date().toISOString(),
  };
}

/** Deterministic JSON — keys sorted recursively — so signer and verifier agree. */
export function stableStringify(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const o = obj as Record<string, unknown>;
  return (
    '{' +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(o[k]))
      .join(',') +
    '}'
  );
}

/** The exact bytes that get signed: { nodeId, timestamp, body } with a stable body. */
export function canonicalPayload(
  nodeId: string,
  timestamp: number,
  body: Record<string, unknown>,
): string {
  const clean: Record<string, unknown> = { ...body };
  delete clean.signature;
  delete clean.timestamp;
  return JSON.stringify({ nodeId, timestamp: Number(timestamp), body: stableStringify(clean) });
}

export interface SignedHeaders {
  'X-Node-Id': string;
  'X-Node-Signature': string;
  'X-Node-Timestamp': string;
  'Content-Type': string;
}

/** Sign a request body; returns the auth headers to attach. `now` is injectable for tests. */
export function signRequest(
  identity: Identity,
  body: Record<string, unknown> = {},
  now: number = Date.now(),
): SignedHeaders {
  const payload = canonicalPayload(identity.nodeId, now, body);
  const privKey = crypto.createPrivateKey({
    key: Buffer.from(identity.privateKeyB64, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
  const signature = crypto.sign(null, Buffer.from(payload), privKey).toString('base64');
  return {
    'X-Node-Id': identity.nodeId,
    'X-Node-Signature': signature,
    'X-Node-Timestamp': String(now),
    'Content-Type': 'application/json',
  };
}

export interface SignatureFields {
  nodeId: string;
  signature: string;
  timestamp: number | string;
}

/** Server-side counterpart to signRequest — verify a signed request body. */
export function verifyRequest(fields: SignatureFields, body: Record<string, unknown> = {}): boolean {
  try {
    const payload = canonicalPayload(fields.nodeId, Number(fields.timestamp), body);
    const pubKey = crypto.createPublicKey({
      key: Buffer.from(fields.nodeId, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(payload), pubKey, Buffer.from(fields.signature, 'base64'));
  } catch {
    return false;
  }
}

// ── Optional file persistence (opt-in; pure functions above stay filesystem-free) ──

/** Load an identity from disk, or generate + persist a new one (mode 0600). */
export async function loadOrCreateIdentity(filePath: string): Promise<Identity> {
  const { readFile, writeFile, mkdir } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as Identity;
  } catch {
    const id = generateIdentity();
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(id, null, 2), { mode: 0o600 });
    return id;
  }
}

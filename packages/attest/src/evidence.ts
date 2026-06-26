// Evidence — authenticated inputs a verified intent carries. Three kinds:
//   SignedQuote      — a first-party Circuit data-API response, ed25519-signed.
//   InferenceReceipt — a first-party DLLM gateway output, signed by the mesh node key
//                      (turns an AI decision into a verifiable input).
//   ZkTlsProof       — third-party web data proven via zkTLS (TLSNotary/Reclaim).
// Producers sign with sign*(); the gate verifies with verifyEvidence().

import { signPayload, verifyPayload, type AttestSigner } from './sign.ts';

export interface SignedQuote {
  kind: 'signed-quote';
  path: string;
  /** named fields a rule can read, e.g. { price: 1.83, rsi: 27 } */
  data: Record<string, number | string | boolean>;
  ts: number;
  nonce: string;
  key: string; // signer pubkey hex
  sig: string;
}

export interface InferenceReceipt {
  kind: 'inference-receipt';
  inputHash: string;
  outputHash: string;
  /** optional structured decision (e.g. 'BUY' | 'SELL' | 'HOLD') a rule can read. */
  verdict?: string;
  modelFp: string;
  ts: number;
  nonce: string;
  key: string;
  sig: string;
}

export interface ZkTlsProof {
  kind: 'zktls';
  source: string;
  claim: Record<string, number | string | boolean>;
  sessionTime: number;
  nonce: string;
  notary: string; // accepted-notary pubkey/id
  proof: string; // opaque TLSNotary/Reclaim attestation
}

export type Evidence = SignedQuote | InferenceReceipt | ZkTlsProof;

// ── the signed portion (everything except key + sig) ──────────────────────────
function quotePayload(q: Pick<SignedQuote, 'kind' | 'path' | 'data' | 'ts' | 'nonce'>) {
  return { kind: q.kind, path: q.path, data: q.data, ts: q.ts, nonce: q.nonce };
}
function receiptPayload(
  r: Pick<InferenceReceipt, 'kind' | 'inputHash' | 'outputHash' | 'verdict' | 'modelFp' | 'ts' | 'nonce'>,
) {
  return {
    kind: r.kind,
    inputHash: r.inputHash,
    outputHash: r.outputHash,
    verdict: r.verdict ?? null,
    modelFp: r.modelFp,
    ts: r.ts,
    nonce: r.nonce,
  };
}

// ── producer-side signing ─────────────────────────────────────────────────────
export function signQuote(
  signer: AttestSigner,
  fields: Pick<SignedQuote, 'path' | 'data' | 'ts' | 'nonce'>,
): SignedQuote {
  const base = { kind: 'signed-quote' as const, ...fields };
  return { ...base, key: signer.pubkey, sig: signPayload(signer, quotePayload(base)) };
}

export function signInferenceReceipt(
  signer: AttestSigner,
  fields: Pick<InferenceReceipt, 'inputHash' | 'outputHash' | 'verdict' | 'modelFp' | 'ts' | 'nonce'>,
): InferenceReceipt {
  const base = { kind: 'inference-receipt' as const, ...fields };
  return { ...base, key: signer.pubkey, sig: signPayload(signer, receiptPayload(base)) };
}

// ── verification ──────────────────────────────────────────────────────────────
export interface ReplayStore {
  has(nonce: string): boolean;
  add(nonce: string): void;
}
export class MemoryReplayStore implements ReplayStore {
  private readonly seen = new Set<string>();
  has(n: string): boolean {
    return this.seen.has(n);
  }
  add(n: string): void {
    this.seen.add(n);
  }
}

export interface VerifyEvidenceOpts {
  /** producer pubkey hex → which evidence kind it's trusted to sign. */
  acceptedKeys: Record<string, 'data' | 'inference'>;
  /** accepted zkTLS notary ids (quorum/threshold handled by the caller). */
  acceptedNotaries?: string[];
  /** pluggable zkTLS proof verifier (M3). Default: accept iff the notary is accepted
   *  (the cryptographic proof check is wired in M3 — fail-closed until then if you
   *  pass `requireZkTlsProof: true`). */
  verifyZkTls?: (p: ZkTlsProof) => boolean;
  requireZkTlsProof?: boolean;
  now?: () => number;
  maxAgeMs?: number;
  replay?: ReplayStore;
}

export interface EvidenceResult {
  ok: boolean;
  code: string;
}
const rej = (code: string): EvidenceResult => ({ ok: false, code });
const pass: EvidenceResult = { ok: true, code: 'ok' };

/** Verify one evidence item: trusted signer/notary, valid signature/proof, fresh, not replayed. */
export function verifyEvidence(ev: Evidence, opts: VerifyEvidenceOpts): EvidenceResult {
  const now = opts.now ?? Date.now;
  const maxAge = opts.maxAgeMs ?? 60_000;

  if (ev.kind === 'signed-quote') {
    if (opts.acceptedKeys[ev.key] !== 'data') return rej('evidence-untrusted-key');
    if (!verifyPayload(ev.key, quotePayload(ev), ev.sig)) return rej('evidence-invalid');
    if (now() - ev.ts > maxAge) return rej('evidence-stale');
    if (opts.replay?.has(ev.nonce)) return rej('evidence-replay');
    opts.replay?.add(ev.nonce);
    return pass;
  }
  if (ev.kind === 'inference-receipt') {
    if (opts.acceptedKeys[ev.key] !== 'inference') return rej('evidence-untrusted-key');
    if (!verifyPayload(ev.key, receiptPayload(ev), ev.sig)) return rej('evidence-invalid');
    if (now() - ev.ts > maxAge) return rej('evidence-stale');
    if (opts.replay?.has(ev.nonce)) return rej('evidence-replay');
    opts.replay?.add(ev.nonce);
    return pass;
  }
  if (ev.kind === 'zktls') {
    if (!opts.acceptedNotaries?.includes(ev.notary)) return rej('evidence-untrusted-notary');
    if (opts.verifyZkTls) {
      if (!opts.verifyZkTls(ev)) return rej('evidence-invalid');
    } else if (opts.requireZkTlsProof) {
      return rej('evidence-zktls-unverified'); // fail-closed until a real verifier is wired (M3)
    }
    if (now() - ev.sessionTime > maxAge) return rej('evidence-stale');
    if (opts.replay?.has(ev.nonce)) return rej('evidence-replay');
    opts.replay?.add(ev.nonce);
    return pass;
  }
  return rej('evidence-unknown');
}

/** Does any evidence item authenticate `input = value`? (signed-quote field, zktls claim
 *  field, or an inference receipt's verdict). */
export function evidenceBacks(
  evidence: Evidence[],
  input: string,
  value: number | string | boolean,
): boolean {
  for (const ev of evidence) {
    if (ev.kind === 'signed-quote' && input in ev.data && ev.data[input] === value) return true;
    if (ev.kind === 'zktls' && input in ev.claim && ev.claim[input] === value) return true;
    if (ev.kind === 'inference-receipt' && ev.verdict !== undefined && ev.verdict === value) return true;
  }
  return false;
}

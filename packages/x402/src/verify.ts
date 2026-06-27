// Server-side payment verification: confirm an on-chain CIRC transfer to the treasury
// covers the required amount. Ported from circuit-data-api/middleware/x402.js, made
// framework-agnostic — the Solana connection + replay store are injected, so there is
// no hard dependency on @solana/web3.js, Express, or any secrets backend.

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIRC_MINT, MAX_TX_AGE_MS } from './constants.ts';
import { formatCirc } from './quote.ts';

/** Minimal shape of a parsed token balance (subset of @solana/web3.js). */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  programId?: string;
  uiTokenAmount?: { amount?: string };
}

/** Minimal shape of a parsed transaction. */
export interface ParsedTx {
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null;
}

/** Just the method verifyPaymentTx needs — satisfied by a @solana/web3.js Connection. */
export interface ParsedTxConnection {
  getParsedTransaction(
    signature: string,
    opts: { commitment: string; maxSupportedTransactionVersion?: number },
  ): Promise<ParsedTx | null>;
}

/** Replay guard — each signature is single-use. In-memory default; pass your own
 *  (e.g. disk- or Redis-backed) for multi-process services. */
export interface ReplayStore {
  has(sig: string): boolean;
  add(sig: string): void;
}

// DEV-ONLY: in-memory, per-process. Behind multiple workers a payment consumed by one worker is unseen
// by another (replay across workers + paid-but-denied on the client's retry). PROD MUST use a shared,
// durable ReplayStore — FileReplayStore (one host, multiple workers) or a Redis-backed one (multi-host).
export class MemoryReplayStore implements ReplayStore {
  private readonly seen = new Set<string>();
  has(sig: string): boolean {
    return this.seen.has(sig);
  }
  add(sig: string): void {
    this.seen.add(sig);
  }
}

// Durable, cross-PROCESS replay store: one file per consumed signature in a shared directory. Atomic
// (`wx` flag), so concurrent workers on the same host can't both consume the same payment. For multiple
// HOSTS, back it with Redis/DB behind the same ReplayStore interface.
export class FileReplayStore implements ReplayStore {
  private readonly dir: string;
  constructor(dir: string) { this.dir = dir; mkdirSync(dir, { recursive: true }); }
  private p(sig: string): string { return join(this.dir, sig.replace(/[^A-Za-z0-9_-]/g, '_')); }
  has(sig: string): boolean { return existsSync(this.p(sig)); }
  add(sig: string): void {
    try { writeFileSync(this.p(sig), '', { flag: 'wx' }); } catch { /* already consumed → keep first */ }
  }
}

/** Sum CIRC base units that landed in `treasury` within a parsed tx (post − pre). Pure. */
export function circReceived(tx: ParsedTx, treasury: string, mint: string = CIRC_MINT): bigint {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  let received = 0n;
  for (const p of post) {
    if (p.mint !== mint) continue;
    if (p.owner !== treasury) continue;
    const preBal = pre.find((b) => b.accountIndex === p.accountIndex);
    const preAmt = BigInt(preBal?.uiTokenAmount?.amount ?? '0');
    const postAmt = BigInt(p.uiTokenAmount?.amount ?? '0');
    if (postAmt > preAmt) received += postAmt - preAmt;
  }
  return received;
}

export interface VerifyOptions {
  connection: ParsedTxConnection;
  /** The wallet that must have received the CIRC. */
  treasury: string;
  replay?: ReplayStore;
  maxAgeMs?: number;
  now?: () => number;
  /** RPC fetch retries (for propagation lag). */
  retries?: number;
  retryDelayMs?: number;
}

export interface VerifyResult {
  received: bigint;
  required: bigint;
}

/** Verify that `txSignature` is a confirmed, recent CIRC payment to `treasury`
 *  covering `requiredRaw`. Throws on any failure; marks the signature used on success. */
export async function verifyPaymentTx(
  txSignature: string,
  requiredRaw: bigint,
  opts: VerifyOptions,
): Promise<VerifyResult> {
  const { connection, treasury, replay } = opts;
  const maxAgeMs = opts.maxAgeMs ?? MAX_TX_AGE_MS;
  const now = opts.now ?? Date.now;
  const retries = opts.retries ?? 4;
  const retryDelayMs = opts.retryDelayMs ?? 2500;

  if (replay?.has(txSignature)) {
    throw new Error('Transaction signature already used — each signature is single-use');
  }

  let tx: ParsedTx | null = null;
  let lastErr: Error = new Error('Transaction not found on chain');
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
    try {
      tx = await connection.getParsedTransaction(txSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (tx) break;
      lastErr = new Error('Transaction not found on chain (may not be confirmed yet)');
    } catch (e) {
      lastErr = new Error(`RPC error: ${(e as Error).message}`);
    }
  }
  if (!tx) throw lastErr;
  if (tx.meta?.err) throw new Error(`Transaction failed on chain: ${JSON.stringify(tx.meta.err)}`);

  // Age check. A confirmed tx carries blockTime → enforce the window strictly. A null blockTime
  // (unconfirmed/just-landed) can't be aged, so we accept it ONLY when a replay store is configured to
  // bound replay — otherwise we'd be trusting an unaged, undeduplicatable payment, so refuse.
  if (tx.blockTime != null) {
    if (now() - tx.blockTime * 1000 > maxAgeMs) throw new Error('Transaction is too old (outside the max age window)');
  } else if (!replay) {
    throw new Error('Payment tx has no blockTime and no replay store is configured — refusing (use a durable ReplayStore)');
  }

  const received = circReceived(tx, treasury);
  if (received < requiredRaw) {
    throw new Error(
      `Insufficient payment: received ${formatCirc(received)} CIRC, required ${formatCirc(requiredRaw)} CIRC`,
    );
  }

  replay?.add(txSignature);
  return { received, required: requiredRaw };
}

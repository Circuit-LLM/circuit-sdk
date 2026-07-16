// Wallet — SOL + CIRC balances, transfers, and Jupiter swaps. CIRC is a Token-2022
// mint, so transfers use the Token-2022 program. Implements @circuit-llm/x402's
// PaymentWallet (sendCirc), so it drops straight into the payment spine.
// Ported from circuit-cli/src/services/{wallet,solana}.js.

import {
  Connection,
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import { DEFAULT_CONFIG, type CircuitConfig } from '@circuit-llm/core';
import type { PaymentWallet } from '@circuit-llm/x402';
import { loadKeypairFromEnv } from './keypair.ts';
import { InsufficientFundsError, TransactionUnconfirmedError } from './errors.ts';
import { warnIfDefaultPublicRpc } from './rpc-warning.ts';

// Jupiter swap endpoints. The free `lite-api` host is aggressively rate-limited (429 under any load); with
// a Jupiter API key the wallet uses the keyed host and sends `x-api-key`, lifting the limit.
const JUP_LITE = 'https://lite-api.jup.ag/swap/v1';
const JUP_PRO = 'https://api.jup.ag/swap/v1';

/** The fetch shape the wallet uses — injectable for tests, defaults to the global `fetch`. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

// Public RPCs tried (in order) when the primary hits its rate limit / credit cap or stalls. Ported from
// circuit-cli. Re-broadcasting a signed tx is idempotent (fixed signature), so failover is safe on sends
// as well as reads.
const FALLBACK_RPCS = ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'];
const isRateLimited = (e: unknown): boolean =>
  /429|Too Many Requests|max usage|rate limit/i.test((e as { message?: string } | null)?.message ?? '');

// One signature's base fee — below this, a send can't even pay for itself, so it's certainly a SOL problem.
const BASE_FEE_LAMPORTS = 5000n;

// Ed25519 PKCS8 DER framing — prefixes a raw 32-byte seed so node:crypto can load it as a private key
// for detached message signing. Same prefix @circuit-llm/core's owner-auth uses; see docs/canonical-serialization.md.
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// Programs a legitimate payment transaction may touch. signAndSendTransaction refuses to sign a
// server-built tx that references anything else — the guard against a compromised endpoint slipping in
// an Approve/SetAuthority (delegate/authority grant) or a call to an arbitrary program.
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const PAYMENT_PROGRAMS = new Set([SYSTEM_PROGRAM, TOKEN_PROGRAM, TOKEN_2022_PROGRAM, ATA_PROGRAM, COMPUTE_BUDGET_PROGRAM]);
// Allowed instruction discriminators: System Transfer index (u32 LE) = 2; SPL Token Transfer = 3,
// TransferChecked = 12. Everything else (Approve=4, SetAuthority=6, Burn=8, CloseAccount=9, …) is refused.
const SYSTEM_TRANSFER_IX = 2;
const TOKEN_TRANSFER_IXS = new Set([3, 12]);

/** What a payment transaction is expected to do, so signAndSendTransaction can verify before signing. */
export interface ExpectedPayment {
  /** The wallet the funds must go to (native SOL) or whose ATA must receive the token. */
  recipient?: string;
  /** Token mint (omit for native SOL). Required to pin a token-transfer recipient. */
  mint?: string;
  /** Token program that owns the mint (SPL Token vs Token-2022). Required with `mint`. */
  tokenProgram?: string;
}

// A genuinely-missing token account (the wallet never held CIRC) reads as a real zero balance. Any OTHER
// read failure is unknown and must NOT be reported as "insufficient" — that would mask the real error.
const isMissingAccount = (e: unknown): boolean =>
  /could not find account|account (does not exist|not found)|find account|no ata/i.test(
    (e as { message?: string } | null)?.message ?? '',
  );

export interface WalletOptions {
  keypair?: Keypair | null;
  /** Read-only mode: watch this address (no signing). */
  address?: string;
  config?: CircuitConfig;
  /** Inject a connection (for tests / custom RPC); else built from rpcUrl/config. */
  connection?: Connection;
  /** Inject a list of connections to fail over across (tests / advanced); else [primary, ...fallbacks]. */
  connections?: Connection[];
  rpcUrl?: string;
  /** Jupiter API key for swaps — lifts the free tier's rate limit. Falls back to `JUPITER_API_KEY`. */
  jupiterApiKey?: string;
  /** Override the Jupiter swap base URL (else the keyed host when a key is set, else the free `lite-api`). */
  jupiterBaseUrl?: string;
  /** Inject a `fetch` implementation (tests / custom transport); else the global `fetch`. */
  fetchImpl?: FetchLike;
}

export class Wallet implements PaymentWallet {
  readonly keypair: Keypair | null;
  readonly connection: Connection; // the primary (back-compat); reads/sends fail over across `connections`
  private readonly connections: Connection[];
  readonly address: string | null;
  readonly readOnly: boolean;
  private readonly circMint: PublicKey;
  private readonly tokenProgram: PublicKey;
  private readonly decimals: number;
  private readonly pubkey: PublicKey | null;
  private readonly jupiterBase: string;
  private readonly jupiterKey: string | null;
  private readonly fetchImpl: FetchLike;

  constructor(opts: WalletOptions = {}) {
    const cfg = opts.config ?? DEFAULT_CONFIG;
    this.keypair = opts.keypair ?? null;
    this.pubkey = this.keypair
      ? this.keypair.publicKey
      : opts.address
        ? new PublicKey(opts.address)
        : null;
    this.address = this.pubkey ? this.pubkey.toBase58() : null;
    this.readOnly = !this.keypair;
    const primary = opts.rpcUrl ?? cfg.rpcUrl;
    const urls = [primary, ...FALLBACK_RPCS].filter((u, i, a) => !!u && a.indexOf(u) === i);
    this.connections =
      opts.connections ??
      (opts.connection
        ? [opts.connection]
        : urls.map((u) => new Connection(u, { commitment: 'confirmed', disableRetryOnRateLimit: true })));
    this.connection = this.connections[0]!; // the primary
    this.circMint = new PublicKey(cfg.circMint);
    this.tokenProgram = new PublicKey(cfg.circTokenProgram);
    this.decimals = cfg.circDecimals;
    this.jupiterKey = opts.jupiterApiKey ?? process.env.JUPITER_API_KEY ?? null;
    this.jupiterBase = (opts.jupiterBaseUrl ?? (this.jupiterKey ? JUP_PRO : JUP_LITE)).replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    warnIfDefaultPublicRpc(opts); // heads-up (once) if we're on the rate-limited public RPC
  }

  async solBalance(): Promise<number | null> {
    if (!this.pubkey) return null;
    const pk = this.pubkey;
    const lamports = await this.withRpc((c) => c.getBalance(pk, 'confirmed'));
    return lamports / LAMPORTS_PER_SOL;
  }

  async circBalance(): Promise<number> {
    if (!this.pubkey) return 0;
    const ata = getAssociatedTokenAddressSync(this.circMint, this.pubkey, false, this.tokenProgram);
    try {
      const r = await this.withRpc((c) => c.getTokenAccountBalance(ata, 'confirmed'));
      return Number(r.value.amount) / 10 ** this.decimals;
    } catch {
      return 0; // no ATA yet = zero balance
    }
  }

  /** PaymentWallet.sendCirc — transfer CIRC (Token-2022). amountRaw = base units. */
  async sendCirc(toAddress: string, amountRaw: bigint): Promise<string> {
    const kp = this.requireKeypair();
    const to = new PublicKey(toAddress);
    const fromAta = getAssociatedTokenAddressSync(this.circMint, kp.publicKey, false, this.tokenProgram);
    const toAta = getAssociatedTokenAddressSync(this.circMint, to, false, this.tokenProgram);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, this.circMint, this.tokenProgram),
      createTransferCheckedInstruction(fromAta, this.circMint, toAta, kp.publicKey, amountRaw, this.decimals, [], this.tokenProgram),
    );
    try {
      return await this.sendSigned(tx, kp);
    } catch (err) {
      throw (await this.classifyFundsError({ circRaw: amountRaw })) ?? err;
    }
  }

  /** PaymentWallet.sendToken — transfer any SPL / Token-2022 token. amountRaw = base units,
   *  tokenProgram = 'spl' | 'token2022'. Used by the x402 Universal Adapter to pay a registered
   *  token instead of CIRC. Self-built (same as sendCirc), so it takes the trusted-tx path. */
  async sendToken(mint: string, toAddress: string, amountRaw: bigint, decimals: number, tokenProgram: string): Promise<string> {
    const kp = this.requireKeypair();
    const to = new PublicKey(toAddress);
    const mintPk = new PublicKey(mint);
    const prog = new PublicKey(tokenProgram === 'token2022' ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM);
    const fromAta = getAssociatedTokenAddressSync(mintPk, kp.publicKey, false, prog);
    const toAta = getAssociatedTokenAddressSync(mintPk, to, false, prog);
    const tx = new Transaction().add(
      createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, to, mintPk, prog),
      createTransferCheckedInstruction(fromAta, mintPk, toAta, kp.publicKey, amountRaw, decimals, [], prog),
    );
    return await this.sendSigned(tx, kp);
  }

  async sendSol(toAddress: string, sol: number): Promise<string> {
    const kp = this.requireKeypair();
    const lamports = Math.round(sol * LAMPORTS_PER_SOL);
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddress), lamports }),
    );
    try {
      return await this.sendSigned(tx, kp);
    } catch (err) {
      throw (await this.classifyFundsError({ solLamports: BigInt(lamports) + BASE_FEE_LAMPORTS })) ?? err;
    }
  }

  /** Jupiter quote (read-only). amount = base units of inputMint. */
  async swapQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint | number,
    slippageBps = 100,
  ): Promise<unknown> {
    const u = `${this.jupiterBase}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
    const resp = await this.fetchImpl(u, { headers: this.jupHeaders(), signal: AbortSignal.timeout(12_000) });
    if (!resp.ok) throw new Error(`Jupiter quote ${resp.status}`);
    return resp.json();
  }

  /** Jupiter request headers — adds `x-api-key` when a key is configured. */
  private jupHeaders(extra?: Record<string, string>): Record<string, string> {
    return { ...(this.jupiterKey ? { 'x-api-key': this.jupiterKey } : {}), ...extra };
  }

  /** Execute a swap via Jupiter (sign + send the returned versioned tx). */
  async swap(
    inputMint: string,
    outputMint: string,
    amount: bigint | number,
    slippageBps = 100,
  ): Promise<{ sig: string; quote: unknown }> {
    const kp = this.requireKeypair();
    const quote = await this.swapQuote(inputMint, outputMint, amount, slippageBps);
    const swapResp = await this.fetchImpl(`${this.jupiterBase}/swap`, {
      method: 'POST',
      headers: this.jupHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.address,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!swapResp.ok) throw new Error(`Jupiter swap ${swapResp.status}`);
    const { swapTransaction } = (await swapResp.json()) as { swapTransaction: string };
    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, 'base64'));
    tx.sign([kp]);
    const sig = await this.withRpc(async (c) => {
      const s = await c.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      await c.confirmTransaction(s, 'confirmed');
      return s;
    });
    return { sig, quote };
  }

  /** Sign an arbitrary message with the wallet key (Ed25519), returning a base58 signature — the shape
   *  Circuit's wallet-signature auth expects (e.g. the models gateway's `/account/key`). Strings are
   *  signed as their UTF-8 bytes. Throws in read-only mode. */
  signMessage(message: string | Uint8Array): string {
    const kp = this.requireKeypair();
    const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
    const priv = crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(kp.secretKey.slice(0, 32))]),
      format: 'der',
      type: 'pkcs8',
    });
    return bs58.encode(crypto.sign(null, Buffer.from(bytes), priv));
  }

  // Verify a server-built payment tx does ONLY what a payment should before we countersign it: every
  // instruction targets an allow-listed program, token instructions are transfers (not Approve/SetAuthority/
  // Burn/Close), and — when `expected` is given — every transfer goes to the expected recipient. Fails
  // closed. Defends against a compromised/MITM'd endpoint returning a tx that grants a delegate or redirects
  // funds; `signAndSendTransaction` blind-signing whatever bytes it's handed would otherwise authorize it.
  private assertSafePayment(tx: Transaction, expected?: ExpectedPayment): void {
    for (const ix of tx.instructions) {
      const pid = ix.programId.toBase58();
      if (!PAYMENT_PROGRAMS.has(pid)) {
        throw new Error(`refusing to sign: transaction references an unexpected program ${pid} (payments use only System/Token/ATA/ComputeBudget)`);
      }
      if (pid === SYSTEM_PROGRAM) {
        const idx = ix.data.length >= 4 ? ix.data.readUInt32LE(0) : -1;
        if (idx !== SYSTEM_TRANSFER_IX) throw new Error(`refusing to sign: disallowed System instruction ${idx} (only Transfer is allowed)`);
        if (expected?.recipient) {
          const dest = ix.keys[1]?.pubkey?.toBase58();
          if (dest !== expected.recipient) throw new Error(`refusing to sign: SOL transfer to ${dest ?? '?'} — expected ${expected.recipient}`);
        }
      } else if (pid === TOKEN_PROGRAM || pid === TOKEN_2022_PROGRAM) {
        const disc = ix.data[0] ?? -1;
        if (!TOKEN_TRANSFER_IXS.has(disc)) throw new Error(`refusing to sign: disallowed token instruction ${disc} (only Transfer/TransferChecked)`);
        if (expected?.recipient) {
          if (!expected.mint || !expected.tokenProgram) throw new Error('refusing to sign: cannot verify a token-transfer recipient without expected.mint + expected.tokenProgram');
          const destIdx = disc === 12 ? 2 : 1; // TransferChecked: [src, mint, dest, owner]; Transfer: [src, dest, owner]
          const dest = ix.keys[destIdx]?.pubkey?.toBase58();
          const wantAta = getAssociatedTokenAddressSync(new PublicKey(expected.mint), new PublicKey(expected.recipient), false, new PublicKey(expected.tokenProgram)).toBase58();
          if (dest !== wantAta) throw new Error(`refusing to sign: token transfer to ${dest ?? '?'} — expected the recipient's ATA ${wantAta}`);
        }
      }
      // ATA (create the destination account) + ComputeBudget (priority fee) are benign — allowed as-is.
    }
  }

  /** Sign a server-built, base64-serialized legacy transaction and broadcast it (with RPC failover).
   *  Before signing, the tx is validated to be a plain payment (allow-listed programs; transfers only;
   *  and, when `expected` is passed, going to the expected recipient) — never blind-signed. The server
   *  sets the fee payer + a recent blockhash; we only add our signature, so a re-broadcast on failover is
   *  idempotent (Solana dedups by the fixed signature). Returns the transaction signature. Throws
   *  TransactionUnconfirmedError (carrying the signature) if the tx broadcasts but can't be confirmed. */
  async signAndSendTransaction(base64Tx: string, expected?: ExpectedPayment): Promise<string> {
    const kp = this.requireKeypair();
    const tx = Transaction.from(Buffer.from(base64Tx, 'base64'));
    this.assertSafePayment(tx, expected);
    tx.sign(kp);
    const raw = tx.serialize();
    // Broadcast with failover — the signature is fixed, so re-sending on another RPC re-broadcasts the
    // SAME transaction (never a second one).
    const sig = await this.withRpc((c) => c.sendRawTransaction(raw, { maxRetries: 3 }));
    // Confirm best-effort; if confirmation can't be observed the tx may still land, so surface the signature
    // (never lose it to a blind-retry double-spend).
    try {
      await this.withRpc((c) => c.confirmTransaction(sig, 'confirmed'));
    } catch (e) {
      throw new TransactionUnconfirmedError(sig, (e as { message?: string } | null)?.message);
    }
    return sig;
  }

  // Sign a legacy Transaction ONCE against a fresh blockhash, then broadcast the fixed-signature bytes.
  // Critical for failover: because the signature is fixed, a retry on another RPC re-broadcasts the SAME
  // transaction (Solana dedups by signature) — it can never produce a second, differently-signed tx. If
  // we instead handed an unsigned tx to sendAndConfirmTransaction inside withRpc, each RPC would fetch a
  // new blockhash and re-sign → two transactions could land (a double-spend).
  private async sendSigned(tx: Transaction, kp: Keypair): Promise<string> {
    const { blockhash } = await this.withRpc((c) => c.getLatestBlockhash('confirmed'));
    tx.recentBlockhash = blockhash;
    tx.feePayer = kp.publicKey;
    tx.sign(kp);
    const raw = tx.serialize();
    return this.withRpc(async (c) => {
      const sig = await c.sendRawTransaction(raw, { maxRetries: 3 });
      await c.confirmTransaction(sig, 'confirmed');
      return sig;
    });
  }

  // Try each RPC in turn; advance to the next on a rate-limit error OR a per-try timeout (a capped RPC
  // sometimes hangs rather than throwing). A real (non-rate-limit) error propagates immediately.
  private async withRpc<T>(fn: (c: Connection) => Promise<T>, perTryMs = 25_000): Promise<T> {
    let last: unknown;
    for (const conn of this.connections) {
      try {
        return await Promise.race([
          fn(conn),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(Object.assign(new Error('rpc timeout'), { _timeout: true })), perTryMs).unref();
          }),
        ]);
      } catch (e) {
        last = e;
        if (!isRateLimited(e) && !(e as { _timeout?: boolean } | null)?._timeout) throw e;
      }
    }
    throw last;
  }

  // After a send fails, read balances to see whether it was actually a funds problem — and if so, say so
  // clearly. Returns an InsufficientFundsError to throw, or null to let the original send error propagate.
  // A probe that itself fails returns null, so a real error is never masked by a misattributed message.
  private async classifyFundsError(need: {
    circRaw?: bigint;
    solLamports?: bigint;
  }): Promise<InsufficientFundsError | null> {
    try {
      if (need.circRaw != null) {
        const have = await this.circBalanceRawStrict();
        if (have < need.circRaw) return new InsufficientFundsError('CIRC', have, need.circRaw);
      }
      const solNeed = need.solLamports ?? BASE_FEE_LAMPORTS;
      const haveSol = await this.solLamports();
      if (haveSol < solNeed) return new InsufficientFundsError('SOL', haveSol, solNeed);
      return null;
    } catch {
      return null; // probe failed (e.g. RPC down) — don't guess; leave the original error to propagate
    }
  }

  // Raw CIRC balance in base units. 0 for a genuinely-missing ATA; a real RPC failure is re-thrown.
  private async circBalanceRawStrict(): Promise<bigint> {
    if (!this.pubkey) return 0n;
    const ata = getAssociatedTokenAddressSync(this.circMint, this.pubkey, false, this.tokenProgram);
    try {
      const r = await this.withRpc((c) => c.getTokenAccountBalance(ata, 'confirmed'));
      return BigInt(r.value.amount);
    } catch (e) {
      if (isMissingAccount(e)) return 0n;
      throw e;
    }
  }

  // Raw SOL balance in lamports.
  private async solLamports(): Promise<bigint> {
    if (!this.pubkey) return 0n;
    const pk = this.pubkey;
    return BigInt(await this.withRpc((c) => c.getBalance(pk, 'confirmed')));
  }

  private requireKeypair(): Keypair {
    if (!this.keypair) throw new Error('No wallet loaded — pass a keypair or set CIRCUIT_WALLET');
    return this.keypair;
  }
}

/** Build a Wallet, loading the keypair from CIRCUIT_WALLET when none is given. */
export function makeWallet(opts: WalletOptions = {}): Wallet {
  return new Wallet({ ...opts, keypair: opts.keypair ?? loadKeypairFromEnv() });
}

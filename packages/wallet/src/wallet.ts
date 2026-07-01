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
import { DEFAULT_CONFIG, type CircuitConfig } from '@circuit-llm/core';
import type { PaymentWallet } from '@circuit-llm/x402';
import { loadKeypairFromEnv } from './keypair.ts';
import { InsufficientFundsError } from './errors.ts';
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

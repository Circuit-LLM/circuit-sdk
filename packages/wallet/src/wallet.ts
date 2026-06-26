// Wallet — SOL + CIRC balances, transfers, and Jupiter swaps. CIRC is a Token-2022
// mint, so transfers use the Token-2022 program. Implements @circuit/x402's
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
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import { DEFAULT_CONFIG, type CircuitConfig } from '@circuit/core';
import type { PaymentWallet } from '@circuit/x402';
import { loadKeypairFromEnv } from './keypair.ts';

const JUP = 'https://lite-api.jup.ag/swap/v1';

export interface WalletOptions {
  keypair?: Keypair | null;
  /** Read-only mode: watch this address (no signing). */
  address?: string;
  config?: CircuitConfig;
  /** Inject a connection (for tests / custom RPC); else built from rpcUrl/config. */
  connection?: Connection;
  rpcUrl?: string;
}

export class Wallet implements PaymentWallet {
  readonly keypair: Keypair | null;
  readonly connection: Connection;
  readonly address: string | null;
  readonly readOnly: boolean;
  private readonly circMint: PublicKey;
  private readonly tokenProgram: PublicKey;
  private readonly decimals: number;
  private readonly pubkey: PublicKey | null;

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
    this.connection =
      opts.connection ?? new Connection(opts.rpcUrl ?? cfg.rpcUrl, { commitment: 'confirmed' });
    this.circMint = new PublicKey(cfg.circMint);
    this.tokenProgram = new PublicKey(cfg.circTokenProgram);
    this.decimals = cfg.circDecimals;
  }

  async solBalance(): Promise<number | null> {
    if (!this.pubkey) return null;
    const lamports = await this.connection.getBalance(this.pubkey, 'confirmed');
    return lamports / LAMPORTS_PER_SOL;
  }

  async circBalance(): Promise<number> {
    if (!this.pubkey) return 0;
    const ata = getAssociatedTokenAddressSync(this.circMint, this.pubkey, false, this.tokenProgram);
    try {
      const r = await this.connection.getTokenAccountBalance(ata, 'confirmed');
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
    return sendAndConfirmTransaction(this.connection, tx, [kp], { commitment: 'confirmed' });
  }

  async sendSol(toAddress: string, sol: number): Promise<string> {
    const kp = this.requireKeypair();
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: kp.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: Math.round(sol * LAMPORTS_PER_SOL),
      }),
    );
    return sendAndConfirmTransaction(this.connection, tx, [kp], { commitment: 'confirmed' });
  }

  /** Jupiter quote (read-only). amount = base units of inputMint. */
  async swapQuote(
    inputMint: string,
    outputMint: string,
    amount: bigint | number,
    slippageBps = 100,
  ): Promise<unknown> {
    const u = `${JUP}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&restrictIntermediateTokens=true`;
    const resp = await fetch(u, { signal: AbortSignal.timeout(12_000) });
    if (!resp.ok) throw new Error(`Jupiter quote ${resp.status}`);
    return resp.json();
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
    const swapResp = await fetch(`${JUP}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    await this.connection.confirmTransaction(sig, 'confirmed');
    return { sig, quote };
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

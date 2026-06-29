// makeVaultExecutor — the concrete bridge from a trading INTENT (buy/sell a token for SOL) to a guarded
// on-chain vault trade. This is the object circuit-sdk's VaultCustody calls when it's live (paper=false):
// it maps the intent to mints + amount, asks a route source (Jupiter by default) for the swap, and lands
// it through VaultClient.trade() signed by the DELEGATE key on this host. The delegate can only trade —
// never withdraw — so the worst a tampered host can do is a bounded bad swap; the on-chain guard makes
// theft impossible.
//
// FUNDING MODEL: the vault holds wSOL as its "cash". A BUY spends wSOL → token; a SELL spends token →
// wSOL. Native SOL in the vault is for rent only; the owner funds/​cashes-out via wrap_sol/unwrap_sol
// (CLI `vault fund`). The vault's token accounts (wSOL + each traded mint) must already exist — created
// at setup — because the vault PDA can't pay to create them mid-trade. Transaction FEES are paid by the
// delegate (a tiny host-funded fee wallet), never from vault cash.
//
// The route source is injectable: the default fetches from Jupiter (mainnet liquidity, validated on a
// fork in Phase 6); tests inject a mock-AMM source so the FULL intent→trade path runs on localnet.
import * as anchor from "@anchor-lang/core";
import { VaultClient, TOKEN_PROGRAM_ID } from "./vault-client.ts";
import { jupiterSwapInstruction } from "./jupiter.ts";

// Value symbols via anchor.web3.* (see vault-client.ts note on dts + type-alias collisions).
type PublicKey = anchor.web3.PublicKey;
type Keypair = anchor.web3.Keypair;
type TransactionInstruction = anchor.web3.TransactionInstruction;

const DEFAULT_WSOL = new anchor.web3.PublicKey("So11111111111111111111111111111111111111112");
const LAMPORTS_PER_SOL = 1_000_000_000;

/** The minimal trade request VaultCustody hands the executor (a subset of circuit-sdk's Intent). */
export interface ExecIntent {
  kind: "buy" | "sell";
  token?: string; // the non-SOL mint (buy: output, sell: input)
  sizeSol?: number; // BUY size in SOL notional
  amount?: number; // SELL size in token base units
  maxSlippageBps?: number;
}

export interface RouteQuote {
  swapIx: TransactionInstruction; // the DEX swap (vault PDA as authority)
  inAmount: bigint; // exact input the trade spends (→ trade.amountIn)
  minOut: bigint; // slippage-adjusted output floor (→ trade.minOut, the guard's anti-theft line)
  addressLookupTables?: PublicKey[]; // ALTs the route needs (complex Jupiter routes) → the v0 trade tx
  computeBudgetIxs?: TransactionInstruction[]; // raise the CU limit for the swap (land before the trade)
}

/** Where a swap route comes from. Default = Jupiter; injectable for tests / self-hosted aggregators. */
export interface RouteSource {
  quote(
    p: { inputMint: PublicKey; outputMint: PublicKey; amount: bigint; slippageBps: number },
    vaultAuthority: PublicKey,
  ): Promise<RouteQuote>;
}

/** The production route source: Jupiter v6. */
export function jupiterRouteSource(opts: { base?: string; fetchFn?: typeof fetch } = {}): RouteSource {
  return {
    async quote(p, vaultAuthority) {
      const r = await jupiterSwapInstruction({ ...p, base: opts.base }, vaultAuthority, opts.fetchFn ?? fetch);
      return { swapIx: r.swapIx, inAmount: r.inAmount, minOut: r.minOut, addressLookupTables: r.addressLookupTables, computeBudgetIxs: r.computeBudgetIxs };
    },
  };
}

export interface VaultExecutorOptions {
  client: VaultClient;
  owner: PublicKey;
  agentSeed: Uint8Array | Buffer;
  delegate: Keypair; // the trade-only key on this host
  /** Resolve the vault's token account (ATA) + its token program for a mint. Must already exist. */
  ataFor: (mint: PublicKey) => { account: PublicKey; tokenProgram?: PublicKey };
  /** Route source; defaults to Jupiter. */
  route?: RouteSource;
  /** Verified-intents: build the Ed25519 oracle attestation for a VerifiedIntent (the vault verifies it). */
  attest?: (vi: unknown) => TransactionInstruction;
  /** wSOL mint; override only in tests. */
  wsolMint?: PublicKey;
}

/**
 * Build a VaultTradeExecutor (structurally matches circuit-sdk's `VaultTradeExecutor`). Returned object
 * has `execute(intent, vi?) → { signature, solValue? }`. No circuit-sdk import — the shape is the contract.
 */
export function makeVaultExecutor(o: VaultExecutorOptions) {
  const route = o.route ?? jupiterRouteSource();
  const wsol = o.wsolMint ?? DEFAULT_WSOL;
  const vault = o.client.vaultPda(o.owner, Buffer.from(o.agentSeed));

  return {
    async execute(intent: ExecIntent, vi?: unknown): Promise<{ signature: string; solValue?: number }> {
      if (intent.kind !== "buy" && intent.kind !== "sell") throw new Error(`unsupported intent kind: ${intent.kind}`);
      if (!intent.token) throw new Error("intent.token (mint) is required");
      const token = new anchor.web3.PublicKey(intent.token);
      const slippageBps = intent.maxSlippageBps ?? 100;

      const inputMint = intent.kind === "buy" ? wsol : token;
      const outputMint = intent.kind === "buy" ? token : wsol;
      const amount =
        intent.kind === "buy"
          ? BigInt(Math.round((intent.sizeSol ?? 0) * LAMPORTS_PER_SOL))
          : BigInt(Math.trunc(intent.amount ?? 0));
      if (amount <= 0n) throw new Error("trade amount must be > 0 (buy needs sizeSol, sell needs amount)");

      const q = await route.quote({ inputMint, outputMint, amount, slippageBps }, vault);
      const inAta = o.ataFor(inputMint);
      const outAta = o.ataFor(outputMint);
      if (vi && !o.attest) throw new Error("verified intent requires an `attest` builder to produce the oracle attestation");
      const oracleIx = vi ? o.attest!(vi) : undefined;

      const signature = await o.client.trade({
        owner: o.owner,
        agentSeed: o.agentSeed,
        delegate: o.delegate,
        vaultInput: inAta.account,
        vaultOutput: outAta.account,
        amountIn: q.inAmount,
        minOut: q.minOut,
        swapIx: q.swapIx,
        tokenProgram: inAta.tokenProgram ?? TOKEN_PROGRAM_ID,
        oracleIx,
        addressLookupTables: q.addressLookupTables, // real Jupiter routes → v0 tx with ALTs
        preInstructions: q.computeBudgetIxs, // raise the CU limit for the swap
      });
      // solValue: SOL notional moved (buys spend wSOL; sells receive it — report the wSOL leg).
      const solValue = intent.kind === "buy" ? Number(q.inAmount) / LAMPORTS_PER_SOL : Number(q.minOut) / LAMPORTS_PER_SOL;
      return { signature, solValue };
    },
  };
}

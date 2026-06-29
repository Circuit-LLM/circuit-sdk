// Jupiter swap adapter — turns a Jupiter route into the `TransactionInstruction` that VaultClient.trade()
// wraps. This is the production "trade anything" path: Jupiter aggregates every Solana DEX, so the agent
// asks Jupiter for the best route and hands the resulting swap instruction straight to the vault, which
// guards the OUTCOME (not the route). No Jupiter-specific trust lives in the program.
//
// NOTE: Jupiter has liquidity on mainnet only — there is no devnet/localnet deployment to quote against.
// The adapter is therefore exercised against mainnet (or a mainnet fork) in Phase 6; the localnet test
// suite proves the same wrapping path with a mock AMM. The shape below matches Jupiter's v6 HTTP API.
import * as anchor from "@anchor-lang/core";

// Value symbols via anchor.web3.* (see vault-client.ts note on dts + type-alias collisions).
type PublicKey = anchor.web3.PublicKey;
type TransactionInstruction = anchor.web3.TransactionInstruction;

const JUPITER_V6 = "https://quote-api.jup.ag/v6";

export interface JupiterQuoteParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: bigint | number | string; // input amount, base units
  slippageBps?: number; // default 100 (1%)
  // Reduce route complexity (fewer hops/accounts → less CU, smaller account list). NOTE: this is a hint,
  // not a bound — Jupiter may still return routes whose full account list exceeds the legacy-tx limit
  // (1232 bytes ≈ 33 keys). trade() builds a v0 transaction WITH the returned `addressLookupTables` so
  // any route fits; still, prefer simpler routes and verify the built tx size. See PHASE6 in SECURITY.md.
  maxAccounts?: number; // default 28 (lowers, doesn't bound, account count)
  // Restrict to specific DEXs (comma-separated Jupiter labels, e.g. "Whirlpool,Raydium CLMM,Meteora DLMM").
  // Phase 6 (fork execution) found that some small DEXs reject a PROGRAM-OWNED authority (our vault PDA)
  // with an internal assertion; major CPI-friendly DEXs accept it. Pin those for reliable vault execution.
  dexes?: string;
  base?: string; // override the API base (e.g. a self-hosted Jupiter)
}

export interface JupiterSwapResult {
  swapIx: TransactionInstruction; // hand this to VaultClient.trade({ swapIx })
  inAmount: bigint; // quoted input (use as trade amountIn)
  minOut: bigint; // quoted out minus slippage (use as trade minOut — the guard's anti-theft floor)
  routeLabels: string[]; // e.g. ["Orca", "Raydium"] — for logging/intent
  addressLookupTables: PublicKey[]; // ALTs this route needs to fit a v0 tx (trade() must include them)
}

const jsonToIx = (j: any): TransactionInstruction =>
  new anchor.web3.TransactionInstruction({
    programId: new anchor.web3.PublicKey(j.programId),
    keys: j.accounts.map((a: any) => ({ pubkey: new anchor.web3.PublicKey(a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
    data: Buffer.from(j.data, "base64"),
  });

/**
 * Quote a route and fetch the swap instruction with the VAULT PDA as the user authority. The returned
 * `swapIx` is route-agnostic from the vault's perspective — VaultClient.trade() flips the vault PDA to
 * non-signer (the program re-signs it) and forwards the rest. Use the returned `inAmount`/`minOut` as
 * the trade's `amountIn`/`minOut` so the on-chain guard enforces exactly the slippage Jupiter quoted.
 *
 * `vaultAuthority` is the vault PDA (the swap's user). `fetchFn` defaults to global fetch; pass one in
 * for environments without it. Any setup instructions Jupiter returns (ATA creation, etc.) are returned
 * via `setupIxs` so the caller can land them in a separate, non-guarded transaction first.
 */
export async function jupiterSwapInstruction(
  q: JupiterQuoteParams,
  vaultAuthority: PublicKey,
  fetchFn: typeof fetch = fetch,
): Promise<JupiterSwapResult & { computeBudgetIxs: TransactionInstruction[]; setupIxs: TransactionInstruction[] }> {
  const base = q.base ?? JUPITER_V6;
  const slippageBps = q.slippageBps ?? 100;
  const maxAccounts = q.maxAccounts ?? 28; // keep routes inside the legacy-tx envelope (see JupiterQuoteParams)
  const quoteUrl =
    `${base}/quote?inputMint=${q.inputMint.toBase58()}&outputMint=${q.outputMint.toBase58()}` +
    `&amount=${q.amount.toString()}&slippageBps=${slippageBps}&onlyDirectRoutes=false&maxAccounts=${maxAccounts}` +
    (q.dexes ? `&dexes=${encodeURIComponent(q.dexes)}` : "");
  const quoteRes = await fetchFn(quoteUrl);
  if (!quoteRes.ok) throw new Error(`Jupiter quote failed: ${quoteRes.status} ${await quoteRes.text()}`);
  const quote = (await quoteRes.json()) as any;

  const swapRes = await fetchFn(`${base}/swap-instructions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: vaultAuthority.toBase58(), wrapAndUnwrapSol: false }),
  });
  if (!swapRes.ok) throw new Error(`Jupiter swap-instructions failed: ${swapRes.status} ${await swapRes.text()}`);
  const swap = (await swapRes.json()) as any;
  if (!swap.swapInstruction) throw new Error("Jupiter returned no swapInstruction");

  // Compute-budget ixs (raise the CU limit for the swap) ride WITH the trade as preInstructions; the
  // setup ixs (ATA creation, etc.) are separate — they must land in their own tx before the trade.
  const computeBudgetIxs = (swap.computeBudgetInstructions ?? []).map(jsonToIx);
  const setupIxs = (swap.setupInstructions ?? []).map(jsonToIx);

  return {
    swapIx: jsonToIx(swap.swapInstruction),
    inAmount: BigInt(quote.inAmount),
    minOut: BigInt(quote.otherAmountThreshold), // Jupiter's slippage-adjusted floor
    routeLabels: (quote.routePlan ?? []).map((r: any) => r?.swapInfo?.label).filter(Boolean),
    // The lookup tables this route needs to fit a v0 transaction. trade() includes these when it builds
    // the v0 tx (the legacy path only works for routes whose full account list fits 1232 bytes).
    addressLookupTables: (swap.addressLookupTableAddresses ?? []).map((a: string) => new anchor.web3.PublicKey(a)),
    computeBudgetIxs,
    setupIxs,
  };
}

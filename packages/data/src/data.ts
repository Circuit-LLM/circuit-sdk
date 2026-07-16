// Typed client for the Circuit Data API. Free endpoints (quote/prices/status/probe)
// return 200; paid endpoints answer 402 and the X402Client pays CIRC + retries.
// Catalog from circuit-data-api (see SDK.md Appendix A). Ported onto @circuit-llm/x402.

import { DEFAULT_CONFIG, type CircuitConfig } from '@circuit-llm/core';
import { X402Client, type PaymentWallet, type PaymentQuote } from '@circuit-llm/x402';
import { verifyEvidence, type SignedQuote } from '@circuit-llm/attest';

export interface DataOptions {
  x402?: X402Client;
  wallet?: PaymentWallet;
  maxSpendRaw?: bigint;
  /** Pin payments to the Circuit treasury (recommended) — refuse a 402 demanding any other recipient. */
  allowedRecipients?: string[];
  /** Cumulative CIRC budget (raw) across all calls — bounds a hostile endpoint to a total, not per-call. */
  maxTotalSpendRaw?: bigint;
  /** Pay a registered token instead of CIRC (x402 Universal Adapter): the mint to spend. Needs a wallet
   *  that implements sendToken; falls back to CIRC on any endpoint that doesn't accept the token. */
  payToken?: string;
  /** REQUIRED with payToken: hard per-call ceiling in the token's own base units (fail-closed spend cap). */
  maxPayTokenRaw?: bigint;
  /** Cumulative payToken ceiling (token base units) across all calls. */
  maxTotalPayTokenRaw?: bigint;
  onPay?: (quote: PaymentQuote) => void | Promise<void>;
  config?: CircuitConfig;
  /** Override the data API base (else config.endpoints.data). */
  baseUrl?: string;
  /** X-Internal-Key bypass for trusted/co-located callers (skips payment). */
  internalKey?: string;
  fetchImpl?: typeof fetch;
}

type Query = Record<string, string | number | undefined>;

const csv = (x: string | string[]): string => (Array.isArray(x) ? x.join(',') : x);

export class Data {
  private readonly x402: X402Client;
  private readonly base: string;
  private readonly internalKey?: string;

  constructor(opts: DataOptions = {}) {
    const fetchImpl = opts.fetchImpl ?? fetch;
    this.x402 =
      opts.x402 ??
      new X402Client({
        wallet: opts.wallet,
        maxSpendRaw: opts.maxSpendRaw,
        allowedRecipients: opts.allowedRecipients,
        maxTotalSpendRaw: opts.maxTotalSpendRaw,
        payToken: opts.payToken,
        maxPayTokenRaw: opts.maxPayTokenRaw,
        maxTotalPayTokenRaw: opts.maxTotalPayTokenRaw,
        onPay: opts.onPay,
        fetchImpl,
      });
    const cfg = opts.config ?? DEFAULT_CONFIG;
    this.base = (opts.baseUrl ?? cfg.endpoints.data).replace(/\/$/, '');
    this.internalKey = opts.internalKey;
  }

  private headers(): Record<string, string> {
    return this.internalKey ? { 'X-Internal-Key': this.internalKey } : {};
  }

  /** GET any data-api path (paying CIRC if it answers 402); returns the parsed body. */
  async get<T = unknown>(path: string, query?: Query): Promise<T> {
    let qs = '';
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) if (v != null) params.set(k, String(v));
      const s = params.toString();
      if (s) qs = `?${s}`;
    }
    const { data } = await this.x402.json<T>(`${this.base}${path}${qs}`, { headers: this.headers() });
    return data;
  }

  // ── verified intents (docs/verified-intents.md) ────────────────────────────
  /** GET a path with first-party signing (`?signed=1`): the body comes back as a
   *  SignedQuote envelope the off-box signer accepts as authenticated `data` evidence.
   *  Pass `acceptedKeys` to verify the signature + freshness here too (throws on a bad
   *  quote). The agent forwards the returned envelope as evidence in a verified intent. */
  async getSigned(
    path: string,
    query?: Query,
    opts: { acceptedKeys?: Record<string, 'data' | 'inference'>; maxAgeMs?: number } = {},
  ): Promise<SignedQuote> {
    const env = await this.get<SignedQuote>(path, { ...(query ?? {}), signed: '1' });
    if (!env || env.kind !== 'signed-quote') throw new Error('data-api did not return a SignedQuote — is response signing enabled?');
    if (opts.acceptedKeys) {
      const r = verifyEvidence(env, { acceptedKeys: opts.acceptedKeys, maxAgeMs: opts.maxAgeMs });
      if (!r.ok) throw new Error(`signed-quote failed verification: ${r.code}`);
    }
    return env;
  }

  /** The data-api signing public key (raw hex) to pin in `acceptedKeys`. */
  async signingKey(): Promise<{ key: string; alg: string; kind: string }> {
    return this.get('/.well-known/circuit-data-key');
  }

  // ── free ─────────────────────────────────────────────────────────────────
  /** Live pricing for every endpoint + CIRC conversion (free). */
  quote() { return this.get('/api/quote'); }
  prices(mints: string | string[]) { return this.get('/api/prices', { mints: csv(mints) }); }
  oraclePrices() { return this.get('/api/oracle-prices'); }
  status() { return this.get('/api/status'); }
  probe(source: string) { return this.get('/api/probe', { source }); }

  // ── token ────────────────────────────────────────────────────────────────
  tokenPrice(mint: string) { return this.get('/api/token-price', { mint }); }
  tokenPrices(mints: string | string[]) { return this.get('/api/token-prices', { mints: csv(mints) }); }
  tokenInfo(mint: string) { return this.get('/api/token-info', { mint }); }
  tokenOhlcv(mint: string, opts: { window?: string; limit?: number } = {}) {
    return this.get('/api/token-ohlcv', { mint, window: opts.window, limit: opts.limit });
  }
  tokenHolders(mint: string) { return this.get('/api/token-holders', { mint }); }
  /** Holder breakdowns for many mints at once (comma-batched). */
  tokenHoldersBatch(mints: string | string[]) { return this.get('/api/token-holders-batch', { mints: csv(mints) }); }
  tokenSecurity(mint: string) { return this.get('/api/token-security', { mint }); }
  tokenTopTraders(mint: string) { return this.get('/api/token-top-traders', { mint }); }
  tokenTrending() { return this.get('/api/token-trending'); }
  scan(mint: string) { return this.get('/api/scan', { mint }); }

  // ── wallet ───────────────────────────────────────────────────────────────
  walletAnalytics(wallet: string) { return this.get('/api/wallet-analytics', { wallet }); }
  walletPnl(wallet: string) { return this.get('/api/wallet-pnl', { wallet }); }

  // ── market ───────────────────────────────────────────────────────────────
  marketOverview() { return this.get('/api/market-overview'); }
  marketSentiment() { return this.get('/api/market-sentiment'); }
  /** Risk-on/risk-off regime read (breadth, momentum, volatility). */
  marketRegime() { return this.get('/api/market-regime'); }
  newTokens() { return this.get('/api/new-tokens'); }

  // ── defi ─────────────────────────────────────────────────────────────────
  defiOverview() { return this.get('/api/defi-overview'); }
  yields() { return this.get('/api/yields'); }
  stakingYields() { return this.get('/api/staking-yields'); }
  /** Top protocols by fees/revenue (DeFiLlama). `limit` ≤ 50, default 20. */
  protocolFees(opts: { limit?: number } = {}) { return this.get('/api/protocol-fees', { limit: opts.limit }); }

  // ── chain ────────────────────────────────────────────────────────────────
  networkStats() { return this.get('/api/network-stats'); }
  /** Solana ecosystem snapshot (top protocols/apps by activity). `limit` ≤ 50, default 20. */
  solanaEcosystem(opts: { limit?: number } = {}) { return this.get('/api/solana-ecosystem', { limit: opts.limit }); }
  news() { return this.get('/api/news'); }
  validators() { return this.get('/api/validators'); }
  bridgeActivity() { return this.get('/api/bridge-activity'); }
  nftOverview() { return this.get('/api/nft-overview'); }
  topPools() { return this.get('/api/top-pools'); }

  // ── price feed (real-time, free) ───────────────────────────────────────────
  // The on-chain reserve-based pricing engine (proxied via circuit-price-feed):
  // live SOL/token prices, slippage, and short-term history/candles. Free, rate-
  // limited; distinct from the aggregated `tokenPrice`/`tokenOhlcv` above.
  /** Current SOL/USD oracle price. */
  solPrice() { return this.get('/api/price-feed/sol-price'); }
  /** Live single-token price (priceSol + priceUsd + source + age). */
  livePrice(mint: string) { return this.get(`/api/price-feed/price/${encodeURIComponent(mint)}`); }
  /** Live prices for up to 20 mints (comma-batched). */
  livePrices(mints: string | string[]) { return this.get('/api/price-feed/prices', { mints: csv(mints) }); }
  /** Enriched token card: live price + on-chain metadata. */
  priceCard(mint: string) { return this.get(`/api/price-feed/token/${encodeURIComponent(mint)}`); }
  /** Top tokens by on-chain CPMM volume. `limit` ≤ 50, default 20. */
  priceFeedTrending(opts: { limit?: number } = {}) { return this.get('/api/price-feed/trending', { limit: opts.limit }); }
  /** Raw pool state (reserves, type, mints) for a pool account. */
  poolState(poolAccount: string) { return this.get(`/api/price-feed/pool/${encodeURIComponent(poolAccount)}`); }
  /** Sell-side price-impact estimate for `tokenAmount` of `mint`. */
  slippageSell(mint: string, tokenAmount: number, opts: { decimals?: number } = {}) {
    return this.get(`/api/price-feed/slippage/sell/${encodeURIComponent(mint)}`, { tokenAmount, decimals: opts.decimals });
  }
  /** Buy-side price-impact estimate for `solAmount` SOL into `mint`. */
  slippageBuy(mint: string, solAmount: number, opts: { decimals?: number } = {}) {
    return this.get(`/api/price-feed/slippage/buy/${encodeURIComponent(mint)}`, { solAmount, decimals: opts.decimals });
  }
  /** Short-term price tick history (ring buffer). `limit` ≤ 300, default 100. */
  priceHistory(mint: string, opts: { limit?: number } = {}) {
    return this.get(`/api/price-feed/history/${encodeURIComponent(mint)}`, { limit: opts.limit });
  }
  /** OHLCV candlesticks (ring buffer). `window` ∈ 1m|5m|1h|1d (default 5m), `limit` ≤ 300. */
  priceCandles(mint: string, opts: { window?: '1m' | '5m' | '1h' | '1d'; limit?: number } = {}) {
    return this.get(`/api/price-feed/candles/${encodeURIComponent(mint)}`, { window: opts.window, limit: opts.limit });
  }
}

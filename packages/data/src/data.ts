// Typed client for the Circuit Data API. Free endpoints (quote/prices/status/probe)
// return 200; paid endpoints answer 402 and the X402Client pays CIRC + retries.
// Catalog from circuit-data-api (see SDK.md Appendix A). Ported onto @circuit/x402.

import { DEFAULT_CONFIG, type CircuitConfig } from '@circuit/core';
import { X402Client, type PaymentWallet, type PaymentQuote } from '@circuit/x402';

export interface DataOptions {
  x402?: X402Client;
  wallet?: PaymentWallet;
  maxSpendRaw?: bigint;
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
  newTokens() { return this.get('/api/new-tokens'); }

  // ── defi ─────────────────────────────────────────────────────────────────
  defiOverview() { return this.get('/api/defi-overview'); }
  yields() { return this.get('/api/yields'); }
  stakingYields() { return this.get('/api/staking-yields'); }

  // ── chain ────────────────────────────────────────────────────────────────
  networkStats() { return this.get('/api/network-stats'); }
  news() { return this.get('/api/news'); }
  validators() { return this.get('/api/validators'); }
  bridgeActivity() { return this.get('/api/bridge-activity'); }
  nftOverview() { return this.get('/api/nft-overview'); }
  topPools() { return this.get('/api/top-pools'); }
}

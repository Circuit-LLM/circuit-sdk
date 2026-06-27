// CIRC pricing + 402-quote parsing. The pure math (circRawFromUsd) matches the
// server (circuit-data-api) so client and server agree on the amount.

import { CIRC_DECIMALS, CIRC_MINT, FALLBACK_CIRC_USD, JUPITER_PRICE_URL } from './constants.ts';

/** Format raw CIRC base units as a human string, e.g. 300000000n → "300.00". */
export function formatCirc(raw: bigint): string {
  return (Number(raw) / 10 ** CIRC_DECIMALS).toFixed(2);
}

/** Raw CIRC base units required for a USD price at a given CIRC/USD rate. Rounds UP in RAW units (NOT to
 *  a whole CIRC token) so a request is charged its fair value, never bumped to the next token boundary —
 *  byte-identical to the server (circuit-data-api/lib/pricing.js) + circuit-py. Pure + deterministic. */
export function circRawFromUsd(usdPrice: number, circUsd: number): bigint {
  const rate = circUsd > 0 ? circUsd : FALLBACK_CIRC_USD;
  return BigInt(Math.ceil((usdPrice / rate) * 10 ** CIRC_DECIMALS));
}

export interface PaymentQuote {
  recipient: string;
  amountRaw: bigint;
  amountDisplay: string;
  token: string;
  tokenDecimals: number;
  usdEquivalent?: number;
  network?: string;
  /** The endpoint path, if known (for logging / approval hooks). */
  path?: string;
  /** The raw `payment` block as received. */
  raw: unknown;
}

/** Parse a 402 response body's `payment` block into a typed quote, or null if it
 *  lacks usable requirements (no recipient / amountRaw). */
export function parse402(body: unknown, path?: string): PaymentQuote | null {
  const pay = (body as { payment?: Record<string, unknown> } | null)?.payment;
  if (!pay || !pay.recipient || pay.amountRaw == null) return null;
  let amountRaw: bigint;
  try {
    amountRaw = BigInt(pay.amountRaw as string | number | bigint);
  } catch {
    return null;
  }
  return {
    recipient: String(pay.recipient),
    amountRaw,
    amountDisplay: (pay.amountDisplay as string) ?? `${formatCirc(amountRaw)} CIRC`,
    token: (pay.token as string) ?? CIRC_MINT,
    tokenDecimals: (pay.tokenDecimals as number) ?? CIRC_DECIMALS,
    usdEquivalent: pay.usdEquivalent as number | undefined,
    network: pay.network as string | undefined,
    path,
    raw: pay,
  };
}

export interface OracleOptions {
  fetchImpl?: typeof fetch;
  jupiterKey?: string;
  /** Injectable clock (ms) for deterministic tests. */
  now?: () => number;
  cacheTtlMs?: number;
  lastKnownTtlMs?: number;
}

/** Live CIRC/USD price with the same 60s cache + 15-min last-known-good fallback
 *  as the server, so a single Jupiter hiccup never over-charges. Injectable for tests. */
export class CircPriceOracle {
  private cached: number | null = null;
  private cachedAt = 0;
  private lastKnown: number | null = null;
  private lastKnownAt = 0;
  private readonly fetchImpl: typeof fetch;
  private readonly jupiterKey: string;
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly lastKnownTtlMs: number;

  constructor(opts: OracleOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.jupiterKey = opts.jupiterKey ?? '';
    this.now = opts.now ?? Date.now;
    this.cacheTtlMs = opts.cacheTtlMs ?? 60_000;
    this.lastKnownTtlMs = opts.lastKnownTtlMs ?? 15 * 60_000;
  }

  /** Current CIRC/USD, or null if the oracle is down and no fresh last-known exists. */
  async get(): Promise<number | null> {
    const t = this.now();
    if (this.cached !== null && t - this.cachedAt < this.cacheTtlMs) return this.cached;
    try {
      const headers = this.jupiterKey ? { 'x-api-key': this.jupiterKey } : undefined;
      const resp = await this.fetchImpl(`${JUPITER_PRICE_URL}?ids=${CIRC_MINT}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) throw new Error(`Jupiter ${resp.status}`);
      const data = (await resp.json()) as Record<string, { usdPrice?: number } | undefined>;
      const price = data[CIRC_MINT]?.usdPrice ?? null;
      if (price && price > 0) {
        this.cached = price;
        this.cachedAt = t;
        this.lastKnown = price;
        this.lastKnownAt = t;
        return price;
      }
    } catch {
      /* fall through to last-known */
    }
    if (this.lastKnown && this.now() - this.lastKnownAt < this.lastKnownTtlMs) return this.lastKnown;
    return null;
  }

  /** Raw CIRC required for a USD price, using the live (or last-known/fallback) rate. */
  async requiredRaw(usdPrice: number): Promise<bigint> {
    const circUsd = await this.get();
    return circRawFromUsd(usdPrice, circUsd && circUsd > 0 ? circUsd : FALLBACK_CIRC_USD);
  }
}

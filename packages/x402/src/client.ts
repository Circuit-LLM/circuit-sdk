// The x402 micropayment client: wrap any request; on 402, pay CIRC from the wallet
// and retry with X-Payment-Signature. Generic + streaming-safe (only the 402 body is
// read, via clone). Ported from circuit-cli/src/services/x402.js, hardened with a
// spend cap and an async approval hook.

import { parse402, type PaymentQuote } from './quote.ts';

/** The only thing the payment spine needs from a wallet. @circuit/wallet (Phase 1)
 *  is one implementation; any object with this shape works (structural typing). */
export interface PaymentWallet {
  /** Send `amountRaw` base units of CIRC to `recipient`; resolve to the tx signature. */
  sendCirc(recipient: string, amountRaw: bigint): Promise<string>;
  readonly address?: string;
}

export class PaymentRequiredError extends Error {
  readonly quote: PaymentQuote | null;
  constructor(quote: PaymentQuote | null) {
    super(`Payment required: ${quote?.amountDisplay ?? '?'} (no wallet configured)`);
    this.name = 'PaymentRequiredError';
    this.quote = quote;
  }
}

export class SpendCapError extends Error {
  readonly quote: PaymentQuote;
  readonly capRaw: bigint;
  constructor(quote: PaymentQuote, capRaw: bigint) {
    super(`Quoted ${quote.amountDisplay} (${quote.amountRaw} raw) exceeds the spend cap of ${capRaw} raw CIRC`);
    this.name = 'SpendCapError';
    this.quote = quote;
    this.capRaw = capRaw;
  }
}

export interface X402Options {
  wallet?: PaymentWallet;
  /** Hard ceiling (raw CIRC base units) per call — refuse to pay a higher quote. */
  maxSpendRaw?: bigint;
  /** Approval/notification hook; may be async. Throw inside it to abort the payment. */
  onPay?: (quote: PaymentQuote) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  /** ms before the single transient-error retry (after the CIRC was already spent). */
  retryDelayMs?: number;
}

export interface X402Result {
  resp: Response;
  paymentTx: string | null;
  quote: PaymentQuote | null;
}

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export class X402Client {
  private readonly wallet?: PaymentWallet;
  private readonly maxSpendRaw?: bigint;
  private readonly onPay?: X402Options['onPay'];
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(opts: X402Options = {}) {
    this.wallet = opts.wallet;
    this.maxSpendRaw = opts.maxSpendRaw;
    this.onPay = opts.onPay;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
  }

  /** Generic pay-and-retry. `requestFn(extraHeaders)` performs one request; on 402 it
   *  is called a second time with the X-Payment-Signature header. */
  async request(
    requestFn: (extraHeaders: Record<string, string>) => Promise<Response>,
  ): Promise<X402Result> {
    let resp = await requestFn({});
    if (resp.ok || resp.status !== 402) return { resp, paymentTx: null, quote: null };

    const body = await resp.clone().json().catch(() => ({}));
    const quote = parse402(body);
    if (!quote) throw new Error('Endpoint returned 402 without usable payment requirements');
    if (!this.wallet) throw new PaymentRequiredError(quote);
    if (this.maxSpendRaw != null && quote.amountRaw > this.maxSpendRaw) {
      throw new SpendCapError(quote, this.maxSpendRaw);
    }

    await this.onPay?.(quote);
    const txSig = await this.wallet.sendCirc(quote.recipient, quote.amountRaw);

    resp = await requestFn({ 'X-Payment-Signature': txSig });
    // One free retry on transient server errors — the CIRC is already spent.
    if (!resp.ok && TRANSIENT.has(resp.status)) {
      await new Promise((r) => setTimeout(r, this.retryDelayMs));
      resp = await requestFn({ 'X-Payment-Signature': txSig });
    }
    return { resp, paymentTx: txSig, quote };
  }

  /** Convenience around a URL + RequestInit (merges the X-Payment-Signature header). */
  async fetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const baseHeaders = (init.headers as Record<string, string> | undefined) ?? {};
    const { resp } = await this.request((extra) =>
      this.fetchImpl(url, { ...init, headers: { ...baseHeaders, ...extra } }),
    );
    return resp;
  }
}

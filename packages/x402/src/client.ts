// The x402 micropayment client: wrap any request; on 402, pay CIRC from the wallet
// and retry with X-Payment-Signature. Generic + streaming-safe (only the 402 body is
// read, via clone). Ported from circuit-cli/src/services/x402.js, hardened with a
// spend cap and an async approval hook.

import { parse402, parseAcceptedTokens, type PaymentQuote } from './quote.ts';

/** The only thing the payment spine needs from a wallet. @circuit-llm/wallet (Phase 1)
 *  is one implementation; any object with this shape works (structural typing). */
export interface PaymentWallet {
  /** Send `amountRaw` base units of CIRC to `recipient`; resolve to the tx signature. */
  sendCirc(recipient: string, amountRaw: bigint): Promise<string>;
  /** Send `amountRaw` base units of a registered token (x402 Universal Adapter). Optional — a
   *  CIRC-only wallet omits it, and `payToken` then falls back to CIRC. `tokenProgram` is
   *  'spl' | 'token2022'. */
  sendToken?(mint: string, recipient: string, amountRaw: bigint, decimals: number, tokenProgram: string): Promise<string>;
  /** Optional payer address, for logging / spend tracking (null when read-only). */
  readonly address?: string | null;
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

export class RecipientNotAllowedError extends Error {
  readonly quote: PaymentQuote;
  constructor(quote: PaymentQuote) {
    super(`402 recipient ${quote.recipient} is not in the allowed treasury set — refusing to pay`);
    this.name = 'RecipientNotAllowedError';
    this.quote = quote;
  }
}

export class BudgetExceededError extends Error {
  readonly quote: PaymentQuote;
  constructor(quote: PaymentQuote, spentRaw: bigint, budgetRaw: bigint) {
    super(`Paying ${quote.amountRaw} would exceed the session budget (${spentRaw}/${budgetRaw} raw CIRC spent)`);
    this.name = 'BudgetExceededError';
    this.quote = quote;
  }
}

export class X402RequestError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, url: string) {
    super(`HTTP ${status} on ${url}`);
    this.name = 'X402RequestError';
    this.status = status;
    this.body = body;
  }
}

export interface X402JsonResult<T> {
  data: T;
  status: number;
  paymentTx: string | null;
  quote: PaymentQuote | null;
}

export interface X402Options {
  wallet?: PaymentWallet;
  /** Hard ceiling (raw CIRC base units) per call — refuse to pay a higher quote. */
  maxSpendRaw?: bigint;
  /** Pin the payment recipient: refuse any 402 whose recipient isn't in this set (the Circuit
   *  treasury / known payee). Without it, a malicious endpoint dictates where your CIRC goes. */
  allowedRecipients?: string[];
  /** Cumulative ceiling (raw CIRC base units) across ALL calls this client makes — the real drain
   *  guard, since maxSpendRaw alone lets a hostile endpoint take the cap on every request. */
  maxTotalSpendRaw?: bigint;
  /** Pay a registered token instead of CIRC (x402 Universal Adapter): the mint to spend. It must
   *  appear in the 402's `acceptedTokens` AND the wallet must implement `sendToken`, else the client
   *  falls back to CIRC. The CIRC caps (maxSpendRaw/maxTotalSpendRaw) don't apply to a foreign-token
   *  payment — they're CIRC-denominated — but `allowedRecipients` still pins the collector. */
  payToken?: string;
  /** Approval/notification hook; may be async. Throw inside it to abort the payment. */
  onPay?: (quote: PaymentQuote) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  /** ms before the single transient-error retry (after the CIRC was already spent). */
  retryDelayMs?: number;
  /** Per-request timeout (ms) applied via AbortSignal when the caller passes no `signal` of its own,
   *  so a stalled endpoint can't hang the call forever. A fresh budget is used for each attempt of the
   *  pay-and-retry flow (not shared across it). Default 30000; set 0 to disable. */
  timeoutMs?: number;
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
  private readonly allowedRecipients?: Set<string>;
  private readonly maxTotalSpendRaw?: bigint;
  private readonly payToken?: string;
  private readonly onPay?: X402Options['onPay'];
  private readonly fetchImpl: typeof fetch;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;
  private spentRaw = 0n; // cumulative CIRC paid by this client

  constructor(opts: X402Options = {}) {
    this.wallet = opts.wallet;
    this.maxSpendRaw = opts.maxSpendRaw;
    this.allowedRecipients = opts.allowedRecipients ? new Set(opts.allowedRecipients) : undefined;
    this.maxTotalSpendRaw = opts.maxTotalSpendRaw;
    this.payToken = opts.payToken;
    this.onPay = opts.onPay;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.retryDelayMs = opts.retryDelayMs ?? 2000;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** A fresh per-attempt timeout signal (or the caller's own signal if provided). */
  private signal(init: RequestInit): AbortSignal | undefined {
    if (init.signal) return init.signal;
    return this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;
  }

  /** Total CIRC (raw base units) this client has paid so far. */
  get totalSpentRaw(): bigint { return this.spentRaw; }

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

    // x402 Universal Adapter: if configured to pay a registered token AND this 402 lists it, transfer
    // that token to its collector instead of CIRC. Amounts are in the token's own units, so the
    // CIRC-denominated caps don't apply here; allowedRecipients still pins where funds may go.
    if (this.payToken && this.wallet.sendToken) {
      const tk = parseAcceptedTokens(body).find((a) => a.mint === this.payToken);
      if (tk) {
        if (this.allowedRecipients && !this.allowedRecipients.has(tk.recipient)) {
          throw new RecipientNotAllowedError({ ...quote, recipient: tk.recipient });
        }
        const digits = Math.min(tk.decimals, 4);
        const tokenQuote: PaymentQuote = {
          ...quote,
          recipient: tk.recipient,
          amountRaw: tk.amountRaw,
          token: tk.mint,
          tokenDecimals: tk.decimals,
          amountDisplay: `${(Number(tk.amountRaw) / 10 ** tk.decimals).toFixed(digits)} ${tk.symbol ?? 'token'}`,
        };
        await this.onPay?.(tokenQuote);
        const sig = await this.wallet.sendToken(tk.mint, tk.recipient, tk.amountRaw, tk.decimals, tk.tokenProgram);
        resp = await requestFn({ 'X-Payment-Signature': sig });
        if (!resp.ok && TRANSIENT.has(resp.status)) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
          resp = await requestFn({ 'X-Payment-Signature': sig });
        }
        return { resp, paymentTx: sig, quote: tokenQuote };
      }
      // payToken set but this endpoint doesn't accept it → fall through to the CIRC path below.
    }

    if (this.maxSpendRaw != null && quote.amountRaw > this.maxSpendRaw) {
      throw new SpendCapError(quote, this.maxSpendRaw);
    }
    // The recipient + amount come from the (untrusted) endpoint. Pin the recipient to the known
    // treasury and bound the cumulative spend, so a hostile endpoint can't redirect CIRC to itself
    // or take the per-call cap on every request.
    if (this.allowedRecipients && !this.allowedRecipients.has(quote.recipient)) {
      throw new RecipientNotAllowedError(quote);
    }
    if (this.maxTotalSpendRaw != null && this.spentRaw + quote.amountRaw > this.maxTotalSpendRaw) {
      throw new BudgetExceededError(quote, this.spentRaw, this.maxTotalSpendRaw);
    }

    await this.onPay?.(quote);
    const txSig = await this.wallet.sendCirc(quote.recipient, quote.amountRaw);
    this.spentRaw += quote.amountRaw; // count it once, after the send is initiated

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
      this.fetchImpl(url, { ...init, headers: { ...baseHeaders, ...extra }, signal: this.signal(init) }),
    );
    return resp;
  }

  /** Pay-and-parse-JSON: like fetch() but parses the body and throws X402RequestError
   *  on a non-2xx final response. NOT for streaming responses — use request() for those. */
  async json<T = unknown>(url: string | URL, init: RequestInit = {}): Promise<X402JsonResult<T>> {
    const baseHeaders = (init.headers as Record<string, string> | undefined) ?? {};
    const { resp, paymentTx, quote } = await this.request((extra) =>
      this.fetchImpl(url, { ...init, headers: { ...baseHeaders, ...extra }, signal: this.signal(init) }),
    );
    const text = await resp.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!resp.ok) throw new X402RequestError(resp.status, body, String(url));
    return { data: body as T, status: resp.status, paymentTx, quote };
  }
}

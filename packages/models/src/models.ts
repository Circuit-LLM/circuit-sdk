// Client for the Circuit models gateway (circuit-models-gateway) that powers
// https://circuitllm.xyz/models — a pay-as-you-go, OpenAI-compatible reseller of OpenRouter,
// paid in Solana crypto against a prepaid USD ledger.
//
// Three concerns, only the first of which has an off-the-shelf equivalent:
//   • chat        — call the metered OpenAI-compatible API with a `sk-circuit-` key. (The plain OpenAI
//                   SDK works too; `openaiBaseUrl` below is the base URL to hand it.)
//   • account/key — issue or rotate your `sk-circuit-` key, gated by a wallet signature. No third-party
//                   SDK does this — it's Circuit-specific.
//   • purchase    — buy USD credits with USDC / SOL / CIRC: build → sign+send → verify. Also Circuit-only.
//
// Auth models differ from @circuit-llm/inference on purpose: the DLLM mesh (inference) pays per call in
// CIRC via x402; this gateway debits a prepaid balance behind a Bearer key. They are separate services.

import type { ChatMessage } from '@circuit-llm/core';
import type { Wallet } from '@circuit-llm/wallet';

/** Tokens the gateway accepts for buying credits. */
export type CreditToken = 'USDC' | 'SOL' | 'CIRC';

/** A catalog entry — an OpenRouter model object with Circuit's markup already applied to pricing. */
export interface ModelInfo {
  id: string;
  [k: string]: unknown;
}

export interface Catalog {
  markup_bps: number;
  count: number;
  data: ModelInfo[];
}

export interface AccountInfo {
  balanceUsd: number;
  hasKey: boolean;
  purchasedUsd?: number;
  spentUsd?: number;
  orUsage?: { usage: number; limit: number | null; limit_remaining: number | null } | null;
  [k: string]: unknown;
}

export interface PurchaseQuote {
  token: CreditToken;
  usd: number;
  amountTokens: number;
  priceUsd: number;
  minUsd: number;
}

export interface BuiltPurchase {
  /** Base64 unsigned legacy transaction — sign + broadcast it, then verify with the signature. */
  transaction: string;
  token: CreditToken;
  amountTokens: number;
  usd: number;
  priceUsd: number;
  payTo: string;
}

export interface KeyResult {
  ok: boolean;
  /** The `sk-circuit-` API key — shown once; any previous key is now invalid. */
  circuitKey: string;
  base_url: string;
  note?: string;
}

export interface PurchaseVerifyResult {
  ok: boolean;
  /** True while the on-chain payment is not yet confirmed — retry. */
  pending?: boolean;
  alreadyCredited?: boolean;
  creditedUsd?: number;
  token?: CreditToken;
  tokenAmount?: number;
  balanceUsd?: number;
  /** Present when this purchase created the account (its first `sk-circuit-` key). */
  circuitKey?: string | null;
  [k: string]: unknown;
}

export interface BuyResult extends PurchaseVerifyResult {
  /** The on-chain payment transaction signature. */
  paymentSig: string;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ChatParams {
  messages: ChatMessage[];
  /** e.g. 'openai/gpt-4o-mini', 'anthropic/claude-sonnet-4' — else the constructor's `model`. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  content: string;
  usage: Usage | null;
  raw: unknown;
}

export interface ModelsOptions {
  /** Wallet for account/key + purchase flows (and to auto-sign). Omit for chat-only use. */
  wallet?: Wallet;
  /** `sk-circuit-` key for chat. Falls back to `CIRCUIT_MODELS_KEY`. */
  apiKey?: string;
  /** Default chat model id when a call omits one. */
  model?: string;
  /** Gateway root. Default `https://circuitllm.xyz/api` (management under `/models`, chat under `/v1`). */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface BuyOptions {
  /** Delay between verification polls (ms). Default 3000. */
  pollMs?: number;
  /** Give up polling after this long (ms). Default 90000. */
  timeoutMs?: number;
}

/** Canonical message the gateway's `/account/key` verifies. MUST stay byte-identical with
 *  circuit-models-gateway/lib/auth.js `authMessage`. */
export function modelsAuthMessage(wallet: string, ts: number): string {
  return `Circuit Models\nwallet:${wallet}\nts:${ts}`;
}

export class ModelsError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ModelsError';
    this.status = status;
    this.body = body;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Mint + token program per accepted token, so buy() can tell the wallet the exact expected on-chain
// recipient and refuse to sign a purchase tx that pays anywhere else. SOL is native (no mint/ATA).
const TOKEN_META: Record<CreditToken, { mint?: string; tokenProgram?: string }> = {
  SOL: {},
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
  CIRC: { mint: '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump', tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' },
};

export class Models {
  private readonly wallet?: Wallet;
  private readonly apiKey?: string;
  private readonly model?: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ModelsOptions = {}) {
    this.wallet = opts.wallet;
    this.apiKey = opts.apiKey ?? process.env.CIRCUIT_MODELS_KEY ?? undefined;
    this.model = opts.model;
    this.base = (opts.baseUrl ?? 'https://circuitllm.xyz/api').replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Base URL to hand the OpenAI SDK: `new OpenAI({ baseURL: models.openaiBaseUrl, apiKey })`. */
  get openaiBaseUrl(): string {
    return `${this.base}/v1`;
  }

  // ── catalog / stats (public) ────────────────────────────────────────────────
  /** The full model catalog with Circuit's markup applied to pricing. */
  async catalog(): Promise<ModelInfo[]> {
    const c = await this.req<Catalog>('GET', '/models/catalog');
    return c.data ?? [];
  }

  /** Just the model ids (OpenAI-compatible `/v1/models` passthrough). */
  async listModelIds(): Promise<string[]> {
    const r = await this.req<{ data?: Array<{ id: string }> }>('GET', '/v1/models');
    return (r.data ?? []).map((m) => m.id);
  }

  /** Cumulative gateway usage (tokens served, request count). */
  async stats(): Promise<Record<string, unknown>> {
    return this.req('GET', '/models/stats');
  }

  // ── account + key (wallet-signature gated) ──────────────────────────────────
  /** Balance and key status for `address` (defaults to the configured wallet). Public read. */
  async account(address?: string): Promise<AccountInfo> {
    const wallet = address ?? this.wallet?.address;
    if (!wallet) throw new Error('account(): pass an address or construct Models with a wallet');
    return this.req('GET', `/models/account?wallet=${encodeURIComponent(wallet)}`);
  }

  /** Issue (or rotate) this wallet's `sk-circuit-` API key. Signed by the wallet; the returned key is
   *  shown once and any previous key is immediately invalidated. */
  async issueKey(): Promise<KeyResult> {
    const wallet = this.requireWallet();
    const ts = Date.now();
    const sig = wallet.signMessage(modelsAuthMessage(wallet.address, ts));
    return this.req('POST', '/models/account/key', { wallet: wallet.address, ts, sig });
  }

  // ── buy credits ─────────────────────────────────────────────────────────────
  /** Live quote: how many `token` a USD amount buys right now, plus the minimum purchase. */
  async quote(token: CreditToken, usd: number): Promise<PurchaseQuote> {
    return this.req('GET', `/models/purchase/quote?token=${encodeURIComponent(token)}&usd=${encodeURIComponent(String(usd))}`);
  }

  /** Ask the gateway to build an unsigned transfer of ~`usd` worth of `token` to the payment wallet. */
  async buildPurchase(token: CreditToken, usd: number): Promise<BuiltPurchase> {
    const wallet = this.requireWallet();
    return this.req('POST', '/models/purchase/build', { wallet: wallet.address, token, usd });
  }

  /** Tell the gateway to verify a payment signature and credit the ledger. May return `{ pending: true }`
   *  while the transaction is still confirming — prefer `buy()`, which polls for you. */
  async verifyPurchase(paymentSig: string): Promise<PurchaseVerifyResult> {
    const wallet = this.requireWallet();
    return this.req('POST', '/models/purchase/verify', { wallet: wallet.address, sig: paymentSig });
  }

  /** One-shot top-up: build → sign + broadcast → verify (polling until confirmed). Returns the credited
   *  balance (and, on a brand-new account, its first `circuitKey`). */
  async buy(token: CreditToken, usd: number, opts: BuyOptions = {}): Promise<BuyResult> {
    const wallet = this.requireWallet();
    const { transaction, payTo } = await this.buildPurchase(token, usd);
    const meta = TOKEN_META[token];

    // Sign+send, pinning the recipient so the wallet refuses a tampered tx. If the tx broadcasts but
    // can't be confirmed, we still have the signature — the payment may have landed, so reconcile via
    // verify rather than losing it (a blind buy() retry could double-pay).
    let paymentSig: string;
    try {
      paymentSig = await wallet.signAndSendTransaction(transaction, { recipient: payTo, mint: meta.mint, tokenProgram: meta.tokenProgram });
    } catch (e) {
      const sig = (e as { signature?: string })?.signature;
      if (!sig) throw e;
      paymentSig = sig;
    }

    // Poll the gateway to credit the ledger, tolerating transient errors until the deadline. Whatever
    // this throws always carries paymentSig so a paid-but-uncredited purchase can be reconciled.
    const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
    let lastError: string | undefined;
    for (;;) {
      try {
        const r = await this.verifyPurchase(paymentSig);
        if (!r.pending) return { ...r, paymentSig };
        lastError = undefined;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e); // transient gateway/network blip — keep polling
      }
      if (Date.now() >= deadline) {
        throw new ModelsError(`purchase not confirmed before timeout — reconcile with paymentSig ${paymentSig}`, 202, { paymentSig, pending: true, lastError });
      }
      await sleep(opts.pollMs ?? 3000);
    }
  }

  // ── chat (OpenAI-compatible, metered against balance) ───────────────────────
  /** Non-streaming completion. Debits the prepaid balance; 402 means out of credits. */
  async chat(params: ChatParams): Promise<ChatResult> {
    const resp = await this.chatRequest(params, false);
    const data = (await this.readJson(resp)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Usage;
    };
    return {
      content: data?.choices?.[0]?.message?.content?.trim() ?? '',
      usage: data?.usage ?? null,
      raw: data,
    };
  }

  /** Streaming completion. Yields content deltas; the generator's return value is { content, usage }. */
  async *chatStream(params: ChatParams): AsyncGenerator<string, { content: string; usage: Usage | null }, void> {
    const resp = await this.chatRequest(params, true);
    if (!resp.body) throw new Error('chat response had no body to stream');
    let content = '';
    let usage: Usage | null = null;
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            usage?: Usage;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            yield delta;
          }
          if (json.usage) usage = json.usage;
        } catch {
          /* ignore keep-alive / partial frames */
        }
      }
    }
    return { content, usage };
  }

  // ── internals ───────────────────────────────────────────────────────────────
  private async chatRequest(params: ChatParams, stream: boolean): Promise<Response> {
    const key = this.requireKey();
    const model = params.model ?? this.model;
    if (!model) throw new Error('chat(): no model set — pass `model` (e.g. "openai/gpt-4o-mini") or a constructor default');
    const resp = await this.fetchImpl(`${this.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: params.messages,
        ...(params.maxTokens != null ? { max_tokens: params.maxTokens } : {}),
        ...(params.temperature != null ? { temperature: params.temperature } : {}),
        stream,
      }),
      signal: params.signal ?? AbortSignal.timeout(params.timeoutMs ?? 120_000),
    });
    if (!resp.ok) {
      const body = await this.readJson(resp).catch(() => ({}));
      const b = body as { error?: { message?: string } | string };
      const msg = typeof b.error === 'string' ? b.error : (b.error?.message ?? resp.statusText);
      throw new ModelsError(`chat ${resp.status}: ${msg}`, resp.status, body);
    }
    return resp;
  }

  private async req<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const resp = await this.fetchImpl(this.base + path, {
      method,
      headers: body === undefined ? undefined : JSON_HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await this.readJson(resp);
    if (!resp.ok) {
      const d = data as { error?: { message?: string } | string; detail?: string };
      const err = typeof d?.error === 'string' ? d.error : d?.error?.message;
      throw new ModelsError(`${resp.status} ${err ?? d?.detail ?? resp.statusText}`, resp.status, data);
    }
    return data as T;
  }

  private async readJson(resp: Response): Promise<unknown> {
    const text = await resp.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  }

  private requireWallet(): Wallet & { address: string } {
    if (!this.wallet) throw new Error('this operation needs a wallet — construct Models with { wallet }');
    if (!this.wallet.address) throw new Error('wallet has no address (read-only / no keypair loaded)');
    return this.wallet as Wallet & { address: string };
  }

  private requireKey(): string {
    if (!this.apiKey) throw new Error('no Circuit API key — pass { apiKey } or set CIRCUIT_MODELS_KEY (issue one with issueKey())');
    return this.apiKey;
  }
}

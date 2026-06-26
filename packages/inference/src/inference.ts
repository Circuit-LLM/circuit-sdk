// DLLM chat through the Circuit inference gateway, paid per call in CIRC (x402).
// OpenAI-compatible. Non-streaming `chat`, token-streaming `chatStream` (async
// generator). Ported from circuit-cli/src/services/inference.js onto @circuit/x402.

import { DEFAULT_CONFIG, type ChatMessage, type CircuitConfig } from '@circuit/core';
import {
  X402Client,
  type PaymentWallet,
  type PaymentQuote,
} from '@circuit/x402';
import { verifyEvidence, type InferenceReceipt } from '@circuit/attest';

export interface InferenceOptions {
  /** A pre-built payment client. If omitted, one is built from `wallet`. */
  x402?: X402Client;
  /** Wallet to pay with (used only when `x402` is not provided). */
  wallet?: PaymentWallet;
  /** Per-call CIRC spend cap (raw base units), passed to the built X402Client. */
  maxSpendRaw?: bigint;
  /** Approval/notification hook for payments. */
  onPay?: (quote: PaymentQuote) => void | Promise<void>;
  config?: CircuitConfig;
  /** Override the inference base URL (else config.endpoints.inference). */
  baseUrl?: string;
  /** Default model id (else config.model, e.g. 'circuit'). */
  model?: string;
  /** X-Internal-Key bypass for trusted/co-located callers (skips payment). */
  internalKey?: string;
  fetchImpl?: typeof fetch;
}

export interface ChatParams {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface Usage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

export interface ChatResult {
  content: string;
  usage: Usage | null;
  paymentTx: string | null;
  quote: PaymentQuote | null;
  raw: unknown;
}

export type ChatStreamResult = Omit<ChatResult, 'raw'>;

export class Inference {
  private readonly x402: X402Client;
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;
  private readonly model: string;
  private readonly internalKey?: string;

  constructor(opts: InferenceOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.x402 =
      opts.x402 ??
      new X402Client({
        wallet: opts.wallet,
        maxSpendRaw: opts.maxSpendRaw,
        onPay: opts.onPay,
        fetchImpl: this.fetchImpl,
      });
    const cfg = opts.config ?? DEFAULT_CONFIG;
    this.base = (opts.baseUrl ?? cfg.endpoints.inference).replace(/\/$/, '');
    this.model = opts.model ?? cfg.model;
    this.internalKey = opts.internalKey;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.internalKey) h['X-Internal-Key'] = this.internalKey;
    return h;
  }

  private body(params: ChatParams, stream: boolean): string {
    return JSON.stringify({
      model: params.model ?? this.model,
      messages: params.messages,
      max_tokens: params.maxTokens ?? 512,
      temperature: params.temperature ?? 0.5,
      stream,
    });
  }

  /** List available model ids (free). */
  async listModels(): Promise<string[]> {
    const { data } = await this.x402.json<{ data?: Array<{ id: string }> }>(`${this.base}/models`, {
      headers: this.headers(),
    });
    return (data?.data ?? []).map((m) => m.id);
  }

  /** Non-streaming completion. Pays CIRC if the gateway answers 402. */
  async chat(params: ChatParams): Promise<ChatResult> {
    const { data, paymentTx, quote } = await this.x402.json<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Usage;
    }>(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(params, false),
      signal: params.signal ?? AbortSignal.timeout(params.timeoutMs ?? 120_000),
    });
    return {
      content: data?.choices?.[0]?.message?.content?.trim() ?? '',
      usage: data?.usage ?? null,
      paymentTx,
      quote,
      raw: data,
    };
  }

  // ── verified intents (docs/verified-intents.md) ────────────────────────────
  /** Non-streaming completion with a signed InferenceReceipt (`?signed=1`): proves the
   *  mesh produced this output for this input. The agent forwards `receipt` as evidence so
   *  the off-box signer trusts the AI's call (a short answer like "BUY" becomes `verdict`).
   *  Pass `acceptedKeys` to verify the receipt here too (throws on a bad receipt). */
  async chatVerified(
    params: ChatParams,
    opts: { acceptedKeys?: Record<string, 'data' | 'inference'>; maxAgeMs?: number } = {},
  ): Promise<ChatResult & { receipt: InferenceReceipt }> {
    const { data, paymentTx, quote } = await this.x402.json<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: Usage;
      attestation?: InferenceReceipt;
    }>(`${this.base}/chat/completions?signed=1`, {
      method: 'POST',
      headers: this.headers(),
      body: this.body(params, false),
      signal: params.signal ?? AbortSignal.timeout(params.timeoutMs ?? 120_000),
    });
    const receipt = data?.attestation;
    if (!receipt || receipt.kind !== 'inference-receipt') throw new Error('gateway did not return an InferenceReceipt — is receipt signing enabled?');
    if (opts.acceptedKeys) {
      const r = verifyEvidence(receipt, { acceptedKeys: opts.acceptedKeys, maxAgeMs: opts.maxAgeMs });
      if (!r.ok) throw new Error(`inference-receipt failed verification: ${r.code}`);
    }
    return {
      content: data?.choices?.[0]?.message?.content?.trim() ?? '',
      usage: data?.usage ?? null,
      paymentTx,
      quote,
      raw: data,
      receipt,
    };
  }

  /** The inference signing public key (raw hex) to pin in `acceptedKeys`. */
  async signingKey(): Promise<{ key: string; alg: string; kind: string }> {
    const root = this.base.replace(/\/v1$/, '');
    const { data } = await this.x402.json<{ key: string; alg: string; kind: string }>(
      `${root}/.well-known/circuit-inference-key`,
      { headers: this.headers() },
    );
    return data;
  }

  /** Streaming completion. Yields token deltas as they arrive; the generator's
   *  return value is the full { content, usage, paymentTx, quote }. */
  async *chatStream(params: ChatParams): AsyncGenerator<string, ChatStreamResult, void> {
    const url = `${this.base}/chat/completions`;
    const body = this.body(params, true);
    // The gateway answers 402 before streaming, so the handshake is plain JSON.
    const { resp, paymentTx, quote } = await this.x402.request((extra) =>
      this.fetchImpl(url, {
        method: 'POST',
        headers: { ...this.headers(), ...extra },
        body,
        signal: params.signal ?? AbortSignal.timeout(params.timeoutMs ?? 120_000),
      }),
    );
    if (!resp.ok) {
      const e = (await resp.json().catch(() => ({}))) as { error?: string; message?: string };
      throw new Error(`Inference ${resp.status}: ${e.error ?? e.message ?? ''}`);
    }
    if (!resp.body) throw new Error('Inference response had no body to stream');

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
    return { content, usage, paymentTx, quote };
  }
}

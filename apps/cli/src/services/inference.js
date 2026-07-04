// DLLM chat through the Circuit inference gateway.
// If a local Circuit node-client is running, route through it — a live node gets inference FREE
// (the node-client signs the request with its X-Node identity, so the gateway serves it without
// x402). This mirrors how the CLI prefers the local node-client for CPU hosting. Otherwise fall
// back to the gateway and pay CIRC via x402.
// Provides a non-streaming `chat` and a token-streaming `chatStream`.
import { config } from '../config.js';
import { getJson } from './http.js';
import { withX402, PaymentRequiredError } from './x402.js';

const base = () => config.endpoints.inference.replace(/\/$/, '');

// ── free inference via a local node-client (X-Node signature → no x402) ──
const nodeBase = () => config.endpoints.nodeClient.replace(/\/$/, '');
let _nodeUp; // cached once per process — a health probe per completion would add latency
async function nodeUp() {
  if (_nodeUp !== undefined) return _nodeUp;
  try { _nodeUp = (await fetch(nodeBase() + '/health', { signal: AbortSignal.timeout(2500) })).ok; }
  catch { _nodeUp = false; }
  return _nodeUp;
}

// Parse an OpenAI-style SSE stream, calling onToken(delta) as content arrives.
async function readSse(resp, hooks) {
  let content = '', usage = null;
  const reader = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const p = t.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const d = j.choices?.[0]?.delta?.content;
        if (d) { content += d; hooks.onToken?.(d); }
        if (j.usage) usage = j.usage;
      } catch { /* keep-alive / partial */ }
    }
  }
  return { content, usage };
}

// Free completion through the local node-client (/inference/chat streams SSE, free for a live node).
async function nodeCompletion(messages, opts, hooks) {
  const resp = await fetch(nodeBase() + '/inference/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: opts.maxTokens ?? 512, temperature: opts.temperature ?? 0.5 }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(`node inference ${resp.status}: ${e.error ?? e.message ?? ''}`);
  }
  // Only parse SSE when it's actually a stream; anything else → throw so the caller falls back.
  if (!(resp.headers.get('content-type') || '').includes('text/event-stream')) {
    throw new Error('node inference did not return a stream');
  }
  const { content, usage } = await readSse(resp, hooks);
  return { content, usage, paymentTx: null, payment: null, viaNode: true };
}

export async function listModels() {
  const r = await getJson(`${base()}/models`, { timeout: 8000 });
  return (r?.data || []).map((m) => m.id);
}

function buildBody(messages, opts, stream) {
  return JSON.stringify({
    model: opts.model ?? config.inferenceModel,
    messages,
    max_tokens: opts.maxTokens ?? 512,
    // 0.5 default: enough variety for an assistant, low enough that the bilingual
    // 72B doesn't drift into another language mid-answer. Override with --temp.
    temperature: opts.temperature ?? 0.5,
    stream,
  });
}

// Non-streaming completion. Returns { content, usage, paymentTx, payment }.
export async function chat(messages, opts = {}, wallet, hooks = {}) {
  // Free path first: a running local node-client serves inference without x402.
  if (await nodeUp()) { try { return await nodeCompletion(messages, opts, hooks); } catch { _nodeUp = false; } }
  const url = `${base()}/chat/completions`;
  const body = buildBody(messages, opts, false);
  const req = (extra = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extra },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });

  const { resp, paymentTx, payment } = await withX402(req, wallet, { onPay: hooks.onPay });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(`Inference ${resp.status}: ${e.error ?? e.message ?? ''}`);
  }
  const data = await resp.json();
  return {
    content: data.choices?.[0]?.message?.content?.trim() ?? '',
    usage: data.usage ?? null,
    paymentTx,
    payment,
  };
}

// Streaming completion. Calls hooks.onToken(text) as tokens arrive.
// Returns { content, usage, paymentTx, payment }.
export async function chatStream(messages, opts = {}, wallet, hooks = {}) {
  // Free path first: a running local node-client streams inference without x402.
  if (await nodeUp()) { try { return await nodeCompletion(messages, opts, hooks); } catch { _nodeUp = false; } }
  const url = `${base()}/chat/completions`;
  const post = (extra = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extra },
      body: buildBody(messages, opts, true),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });

  // The gateway answers 402 before streaming, so the handshake is plain JSON.
  let resp = await post();
  let paymentTx = null;
  let payment = null;
  if (resp.status === 402) {
    const info = await resp.json().catch(() => ({}));
    payment = info.payment;
    if (!payment?.recipient || !payment?.amountRaw) throw new Error('402 without payment requirements');
    if (!wallet?.keypair) throw new PaymentRequiredError(payment);
    hooks.onPay?.(payment);
    paymentTx = await wallet.sendCirc(payment.recipient, BigInt(payment.amountRaw));
    resp = await post({ 'X-Payment-Signature': paymentTx });
  }
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(`Inference ${resp.status}: ${e.error ?? e.message ?? ''}`);
  }

  // Parse the SSE stream.
  let content = '';
  let usage = null;
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
      const payloadStr = t.slice(5).trim();
      if (payloadStr === '[DONE]') continue;
      try {
        const json = JSON.parse(payloadStr);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          content += delta;
          hooks.onToken?.(delta);
        }
        if (json.usage) usage = json.usage;
      } catch {
        /* ignore keep-alive / partial */
      }
    }
  }
  return { content, usage, paymentTx, payment };
}

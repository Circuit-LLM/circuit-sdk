// DLLM chat through the Circuit inference gateway. Pays CIRC via x402.
// Provides a non-streaming `chat` and a token-streaming `chatStream`.
import { config } from '../config.js';
import { getJson } from './http.js';
import { withX402, PaymentRequiredError } from './x402.js';

const base = () => config.endpoints.inference.replace(/\/$/, '');

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

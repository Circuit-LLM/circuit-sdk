import { test } from 'node:test';
import assert from 'node:assert';
import { Inference } from '../src/inference.ts';
import type { PaymentWallet } from '@circuit/x402';

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function sseResp(frames: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const f of frames) c.enqueue(enc.encode(f));
      c.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const QUOTE = { payment: { recipient: 'T', amountRaw: '10000000', amountDisplay: '10.00 CIRC' } };
const wallet: PaymentWallet = { async sendCirc() { return 'PAYSIG'; } };

test('chat pays on 402, then returns the trimmed content + usage', async () => {
  let calls = 0;
  let header: string | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls++;
    if (calls === 1) return jsonResp(402, QUOTE);
    header = (init.headers as Record<string, string>)['X-Payment-Signature'];
    return jsonResp(200, {
      choices: [{ message: { content: ' Hello ' } }],
      usage: { completion_tokens: 2 },
    });
  }) as typeof fetch;
  const ai = new Inference({ wallet, fetchImpl });
  const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(r.content, 'Hello');
  assert.equal(r.paymentTx, 'PAYSIG');
  assert.equal(header, 'PAYSIG');
  assert.equal(r.usage?.completion_tokens, 2);
});

test('chatStream yields deltas and returns the assembled content + usage', async () => {
  const fetchImpl = (async () =>
    sseResp([
      'data: {"choices":[{"delta":{"content":"He"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"llo"}}]}\n\n',
      'data: {"usage":{"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ])) as typeof fetch;
  const ai = new Inference({ wallet, fetchImpl });
  const gen = ai.chatStream({ messages: [{ role: 'user', content: 'hi' }] });
  const tokens: string[] = [];
  let result: Awaited<ReturnType<typeof gen.next>>['value'] | undefined;
  for (;;) {
    const n = await gen.next();
    if (n.done) {
      result = n.value;
      break;
    }
    tokens.push(n.value);
  }
  assert.deepEqual(tokens, ['He', 'llo']);
  assert.equal((result as { content: string }).content, 'Hello');
  assert.equal((result as { usage: { completion_tokens: number } }).usage.completion_tokens, 2);
});

test('listModels maps the model ids', async () => {
  const fetchImpl = (async () => jsonResp(200, { data: [{ id: 'circuit' }, { id: 'qwen' }] })) as typeof fetch;
  const ai = new Inference({ fetchImpl });
  assert.deepEqual(await ai.listModels(), ['circuit', 'qwen']);
});

test('chat with no wallet throws PaymentRequiredError on 402', async () => {
  const fetchImpl = (async () => jsonResp(402, QUOTE)) as typeof fetch;
  const ai = new Inference({ fetchImpl });
  await assert.rejects(
    () => ai.chat({ messages: [{ role: 'user', content: 'hi' }] }),
    /Payment required/,
  );
});

test('internalKey is sent and bypasses payment (no 402 path)', async () => {
  let sawKey: string | undefined;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sawKey = (init.headers as Record<string, string>)['X-Internal-Key'];
    return jsonResp(200, { choices: [{ message: { content: 'ok' } }] });
  }) as typeof fetch;
  const ai = new Inference({ fetchImpl, internalKey: 'SECRET' });
  const r = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(sawKey, 'SECRET');
  assert.equal(r.content, 'ok');
  assert.equal(r.paymentTx, null);
});

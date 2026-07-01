import { test } from 'node:test';
import assert from 'node:assert';
import { Inference } from '../src/inference.ts';
import { generateAttestSigner, signInferenceReceipt } from '@circuit-llm/attest';

const signer = generateAttestSigner();

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function completion(content: string, receiptOpts?: { tamper?: boolean }) {
  const receipt = signInferenceReceipt(signer, { inputHash: 'ih', outputHash: 'oh', verdict: content, modelFp: 'qwen2.5-72b-awq', ts: Date.now(), nonce: 'r1' });
  if (receiptOpts?.tamper) receipt.verdict = 'SELL';
  return { choices: [{ message: { content } }], usage: { total_tokens: 3 }, model: 'qwen2.5-72b-awq', attestation: receipt };
}

test('chatVerified returns the completion + a verifiable InferenceReceipt', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => { url = u; return jsonResp(200, completion('BUY')); }) as typeof fetch;
  const inf = new Inference({ fetchImpl, baseUrl: 'https://inf.test/v1', internalKey: 'k' });
  const r = await inf.chatVerified({ messages: [{ role: 'user', content: 'BUY or SELL?' }] }, { acceptedKeys: { [signer.pubkey]: 'inference' } });
  assert.equal(r.content, 'BUY');
  assert.equal(r.receipt.kind, 'inference-receipt');
  assert.equal(r.receipt.verdict, 'BUY');
  assert.ok(url?.includes('signed=1'));
});

test('chatVerified throws when the receipt was tampered', async () => {
  const fetchImpl = (async () => jsonResp(200, completion('BUY', { tamper: true }))) as typeof fetch;
  const inf = new Inference({ fetchImpl, baseUrl: 'https://inf.test/v1', internalKey: 'k' });
  await assert.rejects(() => inf.chatVerified({ messages: [{ role: 'user', content: 'x' }] }, { acceptedKeys: { [signer.pubkey]: 'inference' } }), /failed verification/);
});

test('chatVerified throws when no receipt is attached', async () => {
  const fetchImpl = (async () => jsonResp(200, { choices: [{ message: { content: 'BUY' } }] })) as typeof fetch;
  const inf = new Inference({ fetchImpl, baseUrl: 'https://inf.test/v1', internalKey: 'k' });
  await assert.rejects(() => inf.chatVerified({ messages: [{ role: 'user', content: 'x' }] }), /did not return an InferenceReceipt/);
});

test('signingKey fetches /.well-known/circuit-inference-key at the root', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => { url = u; return jsonResp(200, { key: signer.pubkey, alg: 'ed25519', kind: 'inference-receipt' }); }) as typeof fetch;
  const inf = new Inference({ fetchImpl, baseUrl: 'https://inf.test/v1', internalKey: 'k' });
  const k = await inf.signingKey();
  assert.equal(k.key, signer.pubkey);
  assert.equal(url, 'https://inf.test/.well-known/circuit-inference-key');
});

import { test } from 'node:test';
import assert from 'node:assert';
import { Data } from '../src/data.ts';
import { generateAttestSigner, signQuote } from '@circuit-llm/attest';

const signer = generateAttestSigner();

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('getSigned requests ?signed=1 and returns a verifiable SignedQuote', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => {
    url = u;
    const env = signQuote(signer, { path: '/api/token-price?mint=MINT', data: { price: 1.5, mint: 'MINT' }, ts: Date.now(), nonce: 'n1' });
    return jsonResp(200, env);
  }) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  const ev = await data.getSigned('/api/token-price', { mint: 'MINT' }, { acceptedKeys: { [signer.pubkey]: 'data' } });
  assert.equal(ev.kind, 'signed-quote');
  assert.equal(ev.data.price, 1.5);
  assert.ok(url?.includes('signed=1'));
});

test('getSigned throws when the quote fails verification (untrusted key)', async () => {
  const fetchImpl = (async () => {
    const env = signQuote(signer, { path: '/api/token-price', data: { price: 1.5 }, ts: Date.now(), nonce: 'n2' });
    return jsonResp(200, env);
  }) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  await assert.rejects(() => data.getSigned('/api/token-price', { mint: 'MINT' }, { acceptedKeys: {} }), /failed verification/);
});

test('getSigned throws when signing is not enabled (plain body)', async () => {
  const fetchImpl = (async () => jsonResp(200, { price: 1.5 })) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  await assert.rejects(() => data.getSigned('/api/token-price', { mint: 'MINT' }), /did not return a SignedQuote/);
});

test('signingKey fetches /.well-known/circuit-data-key', async () => {
  let url: string | undefined;
  const fetchImpl = (async (u: string) => { url = u; return jsonResp(200, { key: signer.pubkey, alg: 'ed25519', kind: 'signed-quote' }); }) as typeof fetch;
  const data = new Data({ fetchImpl, baseUrl: 'https://api.test' });
  const k = await data.signingKey();
  assert.equal(k.key, signer.pubkey);
  assert.equal(url, 'https://api.test/.well-known/circuit-data-key');
});

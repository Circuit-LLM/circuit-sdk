import { test } from 'node:test';
import assert from 'node:assert';
import { Connection } from '@solana/web3.js';
import { Wallet, type FetchLike } from '../src/wallet.ts';
import { generateKeypair } from '../src/keypair.ts';

const SOL = 'So11111111111111111111111111111111111111112';
const CIRC = '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump';
const noConn = {} as unknown as Connection; // injected → no real RPC, and silences the default-RPC warning

function okJson(obj: unknown): Response {
  return { ok: true, status: 200, async json() { return obj; } } as unknown as Response;
}

type Call = { url: string; headers: Record<string, string>; method?: string };
function capture(handler: (url: string) => Response): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = (input, init) => {
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      method: init?.method,
    });
    return Promise.resolve(handler(String(input)));
  };
  return { fetchImpl, calls };
}

test('swapQuote uses the free lite-api and sends no key header by default', async () => {
  const { fetchImpl, calls } = capture(() => okJson({ outAmount: '42' }));
  const w = new Wallet({ keypair: generateKeypair(), connection: noConn, fetchImpl });
  const q = (await w.swapQuote(SOL, CIRC, 10_000_000)) as { outAmount: string };
  assert.equal(q.outAmount, '42', 'returns the quote body');
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.url, /^https:\/\/lite-api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.equal(calls[0]!.headers['x-api-key'], undefined, 'no key header when no key');
});

test('swapQuote uses the keyed host + x-api-key when a Jupiter key is set', async () => {
  const { fetchImpl, calls } = capture(() => okJson({ outAmount: '7' }));
  const w = new Wallet({ keypair: generateKeypair(), connection: noConn, fetchImpl, jupiterApiKey: 'test-key-123' });
  await w.swapQuote(SOL, CIRC, 1_000_000);
  assert.match(calls[0]!.url, /^https:\/\/api\.jup\.ag\/swap\/v1\/quote\?/);
  assert.equal(calls[0]!.headers['x-api-key'], 'test-key-123');
});

test('JUPITER_API_KEY env is the fallback when no key is passed', async () => {
  process.env.JUPITER_API_KEY = 'env-key-xyz';
  try {
    const { fetchImpl, calls } = capture(() => okJson({ outAmount: '1' }));
    const w = new Wallet({ keypair: generateKeypair(), connection: noConn, fetchImpl });
    await w.swapQuote(SOL, CIRC, 1_000);
    assert.match(calls[0]!.url, /^https:\/\/api\.jup\.ag\//);
    assert.equal(calls[0]!.headers['x-api-key'], 'env-key-xyz');
  } finally {
    delete process.env.JUPITER_API_KEY;
  }
});

test('jupiterBaseUrl overrides the host (trailing slash trimmed)', async () => {
  const { fetchImpl, calls } = capture(() => okJson({ outAmount: '1' }));
  const w = new Wallet({
    keypair: generateKeypair(),
    connection: noConn,
    fetchImpl,
    jupiterBaseUrl: 'https://my-jup.example/v1/',
  });
  await w.swapQuote(SOL, CIRC, 1_000);
  assert.match(calls[0]!.url, /^https:\/\/my-jup\.example\/v1\/quote\?/);
});

test('swap() sends x-api-key + Content-Type on the POST', async () => {
  const { fetchImpl, calls } = capture((url) =>
    url.includes('/quote')
      ? okJson({ outAmount: '5' })
      : ({ ok: false, status: 500, async json() { return {}; } } as unknown as Response),
  );
  const w = new Wallet({ keypair: generateKeypair(), connection: noConn, fetchImpl, jupiterApiKey: 'k9' });
  await assert.rejects(() => w.swap(SOL, CIRC, 1_000_000), /Jupiter swap 500/);
  const post = calls.find((c) => c.url.endsWith('/swap'));
  assert.ok(post, 'the /swap POST was attempted');
  assert.equal(post!.method, 'POST');
  assert.equal(post!.headers['x-api-key'], 'k9');
  assert.equal(post!.headers['Content-Type'], 'application/json');
});

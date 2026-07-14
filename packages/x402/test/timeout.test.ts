// A stalled endpoint (accepts the connection, never responds) must not hang forever: X402Client injects
// a fresh AbortSignal.timeout per attempt when the caller passes no signal of its own.
//
// Note: AbortSignal.timeout() uses an UNREF'd timer (it won't keep the process alive on its own). A real
// fetch keeps the loop alive via its open socket; these fakes emulate that with a ref'd keep-alive timer,
// cleared on abort — otherwise the loop would drain before the timeout could fire.
import { test } from 'node:test';
import assert from 'node:assert';
import { X402Client } from '../src/client.ts';

const hangUntilAbort = ((_url: string, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    const keepAlive = setTimeout(() => {}, 5000); // ref'd — stands in for an open socket
    init?.signal?.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(new Error('The operation was aborted'));
    });
  })) as unknown as typeof fetch;

test('json() aborts a hung request after timeoutMs', async () => {
  const c = new X402Client({ timeoutMs: 40, fetchImpl: hangUntilAbort });
  const started = Date.now();
  await assert.rejects(() => c.json('http://stalled.example/x'), /abort/i);
  assert.ok(Date.now() - started < 2000, 'should abort promptly, not hang');
});

test('a caller-provided signal is respected over the default timeout', async () => {
  let sawSignal: AbortSignal | undefined;
  const capture = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      sawSignal = init?.signal ?? undefined;
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
  const c = new X402Client({ timeoutMs: 40, fetchImpl: capture });
  const ac = new AbortController();
  const p = c.fetch('http://x/y', { signal: ac.signal });
  ac.abort(); // manual abort — fires immediately, no timer needed
  await assert.rejects(() => p, /abort/i);
  assert.equal(sawSignal, ac.signal, 'the client used the caller signal, not its own timeout');
});

test('timeoutMs: 0 disables the default timeout (no signal injected)', async () => {
  let injected: AbortSignal | undefined | null = undefined;
  const capture = ((_url: string, init?: RequestInit) => {
    injected = init?.signal ?? null;
    return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
  }) as unknown as typeof fetch;
  const c = new X402Client({ timeoutMs: 0, fetchImpl: capture });
  await c.json('http://x/z');
  assert.equal(injected, null, 'no timeout signal injected when timeoutMs is 0');
});

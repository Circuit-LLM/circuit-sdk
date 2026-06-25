import { test, afterEach } from 'node:test';
import assert from 'node:assert';
import { getJson, postJson, HttpError } from '../src/http.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stub(status: number, body: string, contentType = 'application/json'): void {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { 'content-type': contentType } })) as typeof fetch;
}

test('getJson parses JSON on 200', async () => {
  stub(200, JSON.stringify({ ok: true }));
  assert.deepEqual(await getJson('http://x'), { ok: true });
});

test('getJson throws HttpError carrying status + body on non-2xx', async () => {
  stub(404, JSON.stringify({ error: 'nope' }));
  await assert.rejects(
    () => getJson('http://x'),
    (e: unknown) => e instanceof HttpError && e.status === 404 && (e.body as any).error === 'nope',
  );
});

test('getJson returns raw text when the body is not JSON', async () => {
  stub(200, 'hello', 'text/plain');
  assert.equal(await getJson('http://x'), 'hello');
});

test('postJson sends a JSON body with content-type', async () => {
  let captured: RequestInit | undefined;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    captured = init;
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await postJson('http://x', { a: 1 });
  assert.equal(captured?.method, 'POST');
  assert.equal(JSON.parse(captured?.body as string).a, 1);
});

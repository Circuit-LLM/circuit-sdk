// Minimal fetch wrapper: JSON in/out, timeouts, typed errors. No retries here —
// callers decide retry policy (x402 needs idempotent care).
// Ported from circuit-cli/src/services/http.js.

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;
  constructor(status: number, body: unknown, url: string) {
    super(`HTTP ${status} on ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

export interface RequestOpts {
  timeout?: number;
  headers?: Record<string, string>;
}

async function parse(resp: Response): Promise<unknown> {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function getJson<T = unknown>(
  url: string,
  { timeout = 8000, headers }: RequestOpts = {},
): Promise<T> {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const body = await parse(resp);
  if (!resp.ok) throw new HttpError(resp.status, body, url);
  return body as T;
}

export async function postJson<T = unknown>(
  url: string,
  data: unknown,
  { timeout = 30000, headers }: RequestOpts = {},
): Promise<T> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await parse(resp);
  if (!resp.ok) throw new HttpError(resp.status, body, url);
  return body as T;
}

// Raw fetch with a timeout — used for streaming and manual status handling.
export function fetchT(url: string, opts: RequestInit = {}, timeout = 120_000): Promise<Response> {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
}

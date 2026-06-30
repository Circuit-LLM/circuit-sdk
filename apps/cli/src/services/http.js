// Minimal fetch wrapper: JSON in/out, timeouts, typed errors. No retries here —
// callers decide retry policy (x402 needs idempotent care).

export class HttpError extends Error {
  constructor(status, body, url) {
    super(`HTTP ${status} on ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

async function parse(resp) {
  const text = await resp.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function getJson(url, { timeout = 8000, headers } = {}) {
  const resp = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  const body = await parse(resp);
  if (!resp.ok) throw new HttpError(resp.status, body, url);
  return body;
}

export async function postJson(url, data, { timeout = 30000, headers } = {}) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await parse(resp);
  if (!resp.ok) throw new HttpError(resp.status, body, url);
  return body;
}

// Raw fetch with a timeout — used for streaming and manual status handling.
export function fetchT(url, opts = {}, timeout = 120000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(timeout) });
}

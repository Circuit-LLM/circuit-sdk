// Minimal Solana JSON-RPC — just enough for the read-only helpers here, so this
// package stays dependency-free (no @solana/web3.js). Mirrors the raw-RPC approach
// in circuit-node-client/lib/stakepoint.js.

export interface RpcOptions {
  rpcUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(`RPC ${code}: ${message}`);
    this.name = 'RpcError';
    this.code = code;
  }
}

let _id = 0;

export async function rpcCall<T = unknown>(
  opts: RpcOptions,
  method: string,
  params: unknown[],
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(opts.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++_id, method, params }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw new RpcError(res.status, `HTTP ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new RpcError(j.error.code, j.error.message);
  return j.result as T;
}

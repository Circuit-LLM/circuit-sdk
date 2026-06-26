// NodeRegistry — the public network registry client (circuit-node-client/lib/registry.js):
// announce/ping/deregister/peers. Signed with the @circuit/core ed25519 identity
// (SPKI/base64 scheme, X-Node-* headers) — distinct from the mesh control plane.

import { signRequest, type Identity } from '@circuit/core';

export interface NodeRegistryOptions {
  registryUrl: string;
  identity: Identity;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AnnounceParams {
  version: string;
  shards?: string[];
  region?: string;
  agentRunning?: boolean;
  apiPort?: number | null;
  [k: string]: unknown;
}

export class NodeRegistry {
  readonly nodeId: string;
  private readonly base: string;
  private readonly identity: Identity;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: NodeRegistryOptions) {
    this.base = opts.registryUrl.replace(/\/$/, '');
    this.identity = opts.identity;
    this.nodeId = opts.identity.nodeId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Register this node; returns the registered node record. */
  async announce(p: AnnounceParams): Promise<unknown> {
    const { version, shards, region, agentRunning, apiPort, ...extra } = p;
    const body = {
      nodeId: this.nodeId,
      version,
      shards: shards ?? ['all'],
      region: region ?? 'unknown',
      agentRunning: agentRunning ?? false,
      apiPort: apiPort ?? null,
      ...extra,
    };
    const r = await this.signedPost('/api/network/nodes/announce', body);
    return (r as { node?: unknown }).node ?? r;
  }

  /** Heartbeat with an optional status update. */
  ping(update: Record<string, unknown> = {}): Promise<unknown> {
    return this.signedPost('/api/network/nodes/ping', { nodeId: this.nodeId, ...update });
  }

  /** Remove this node's record. */
  async deregister(): Promise<unknown> {
    const headers = signRequest(this.identity, {});
    const res = await this.fetchImpl(`${this.base}/api/network/nodes/${encodeURIComponent(this.nodeId)}`, {
      method: 'DELETE',
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this.parse(res);
  }

  /** List active peers (optionally filtered, e.g. { shard }). */
  async getPeers(filters: Record<string, string> = {}): Promise<unknown[]> {
    const qs = new URLSearchParams(filters).toString();
    const res = await this.fetchImpl(`${this.base}/api/network/nodes${qs ? `?${qs}` : ''}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const r = (await this.parse(res)) as { nodes?: unknown[] };
    return r.nodes ?? [];
  }

  private async signedPost(path: string, body: Record<string, unknown>): Promise<unknown> {
    const headers = signRequest(this.identity, body);
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this.parse(res);
  }

  private async parse(res: Response): Promise<unknown> {
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) throw new Error((body as { error?: string })?.error ?? `HTTP ${res.status}`);
    return body;
  }
}

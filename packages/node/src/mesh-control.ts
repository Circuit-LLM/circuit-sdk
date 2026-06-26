// MeshControl — the inference-mesh control-plane client (circuit-dllm
// engine/control_server.py): join the mesh and stay live. register is signed (mesh
// scheme); ready/heartbeat/drain carry just the node_id; topology/health are GET.
// The actual layer serving stays in the GPU node image — this is the control surface.

import { signMeshBody, type MeshIdentity } from './mesh-identity.ts';

export interface MeshControlOptions {
  controlUrl: string;
  /** Required to register (signs the body); ready/heartbeat/drain only need the node_id. */
  identity?: MeshIdentity;
  nodeId?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RegisterParams {
  endpoint: [string, number];
  capacityLayers: number;
  modelFp: string;
  region?: string;
  payoutWallet?: string;
  reachability?: string;
  orchestrator?: boolean;
  /** Re-register for an already-loaded slot. */
  loadedLayers?: [number, number];
}

export interface RegisterResult {
  assignment: { start: number; end: number } | null;
  orch_index?: number | null;
  model_fp: string;
  session_key: string;
  coordinator: [string, number];
  replication: number;
}

export class MeshControlError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'MeshControlError';
    this.status = status;
  }
}

export class MeshControl {
  readonly nodeId: string | undefined;
  private readonly base: string;
  private readonly identity?: MeshIdentity;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: MeshControlOptions) {
    this.base = opts.controlUrl.replace(/\/$/, '');
    this.identity = opts.identity;
    this.nodeId = opts.identity?.nodeId ?? opts.nodeId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  /** Join the mesh. Requires an identity (signs the request). Returns the assigned
   *  slot, derived session key, etc. */
  async register(p: RegisterParams): Promise<RegisterResult> {
    if (!this.identity) throw new Error('register requires a MeshIdentity to sign the request');
    const body: Record<string, unknown> = {
      endpoint: p.endpoint,
      capacity_layers: p.capacityLayers,
      model_fp: p.modelFp,
      reachability: p.reachability ?? 'public',
      region: p.region ?? '',
      payout_wallet: p.payoutWallet ?? '',
      orchestrator: !!p.orchestrator,
    };
    if (p.loadedLayers) body.loaded_layers = p.loadedLayers;
    return this.post<RegisterResult>('/register', signMeshBody(this.identity, body));
  }

  /** Mark this node READY (serving). */
  ready(): Promise<{ ok?: boolean }> {
    return this.post('/ready', { node_id: this.requireNodeId() });
  }

  /** Heartbeat. `registered:false` means the control plane forgot us → re-register. */
  heartbeat(): Promise<{ ok?: boolean; registered?: boolean }> {
    return this.post('/heartbeat', { node_id: this.requireNodeId() });
  }

  /** Gracefully leave. */
  drain(): Promise<{ ok?: boolean }> {
    return this.post('/drain', { node_id: this.requireNodeId() });
  }

  /** Current mesh topology (free). */
  topology(): Promise<{ slots: unknown[]; coverage_ok: boolean; model_fp?: string; replication?: number }> {
    return this.get('/topology');
  }

  health(): Promise<unknown> {
    return this.get('/health');
  }

  private requireNodeId(): string {
    if (!this.nodeId) throw new Error('no node_id (pass identity or nodeId)');
    return this.nodeId;
  }

  private async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return this.parse<T>(res, path);
  }
  private async get<T = unknown>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    return this.parse<T>(res, path);
  }
  private async parse<T>(res: Response, path: string): Promise<T> {
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
      throw new MeshControlError(res.status, `${path}: ${msg}`);
    }
    return body as T;
  }
}

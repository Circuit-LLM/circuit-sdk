// Custody — how an agent gets a trade authorized + signed. Two implementations:
//   SignerCustody — the real off-box signer (circuit-agent-cloud/signer): the agent
//     holds only a scoped session token + epoch (the fence); the KEY never touches
//     this host. POST /v1/agents/{id}/intent → signed attestation or a rejection code.
//   MockCustody   — local paper trading, no signer, mirroring the signer's policy
//     checks so the SAME agent behaves identically in local dev and on the cloud.

import {
  DEFAULT_POLICY,
  normalizePolicy,
  type Intent,
  type IntentKind,
  type IntentResult,
  type Policy,
} from './types.ts';

export interface SellOpts {
  /** SOL notional (paper sells). */
  sizeSol?: number;
  /** Token base units (live sells). */
  amount?: number;
  maxSlippageBps?: number;
}

export interface Custody {
  readonly kind: 'offbox-signer' | 'local';
  readonly address: string | null;
  readonly paper: boolean;
  /** Submit a raw intent. Resolves to a signed result or a rejection (never throws). */
  intent(intent: Intent): Promise<IntentResult>;
  buy(token: string, sizeSol: number, opts?: Partial<Intent>): Promise<IntentResult>;
  sell(token: string, opts?: SellOpts): Promise<IntentResult>;
}

// ── off-box signer ──────────────────────────────────────────────────────────

export interface SignerCustodyOptions {
  signerUrl: string;
  agentId: string;
  epoch: number;
  session: string;
  address?: string | null;
  paper?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class SignerCustody implements Custody {
  readonly kind = 'offbox-signer' as const;
  readonly address: string | null;
  readonly paper: boolean;
  private readonly base: string;
  private readonly agentId: string;
  private readonly epoch: number;
  private readonly session: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(o: SignerCustodyOptions) {
    this.base = o.signerUrl.replace(/\/$/, '');
    this.agentId = o.agentId;
    this.epoch = o.epoch;
    this.session = o.session;
    this.address = o.address ?? null;
    this.paper = o.paper ?? true;
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.timeoutMs = o.timeoutMs ?? 6000;
  }

  async intent(intent: Intent): Promise<IntentResult> {
    try {
      const res = await this.fetchImpl(`${this.base}/v1/agents/${this.agentId}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ epoch: this.epoch, token: this.session, intent }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<IntentResult>;
      if (res.ok) return { ...j, ok: true, code: j.code ?? 'signed' };
      return { ok: false, code: j.code ?? `http-${res.status}`, error: j.error };
    } catch (e) {
      return { ok: false, code: 'signer-unreachable', error: (e as Error).message };
    }
  }

  buy(token: string, sizeSol: number, opts: Partial<Intent> = {}): Promise<IntentResult> {
    return this.intent({ kind: 'buy', token, sizeSol, ...opts });
  }
  sell(token: string, opts: SellOpts = {}): Promise<IntentResult> {
    return this.intent({ kind: 'sell', token, ...opts });
  }
}

// ── local mock (paper) ──────────────────────────────────────────────────────

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
const reject = (code: string, error: string): IntentResult => ({ ok: false, code, error });

export interface MockCustodyOptions {
  address?: string | null;
  policy?: Partial<Policy>;
  now?: () => number;
}

/** Paper trading with the signer's policy semantics — same rejection codes, so an
 *  agent that works against MockCustody works against the real signer. */
export class MockCustody implements Custody {
  readonly kind = 'local' as const;
  readonly address: string | null;
  readonly paper = true;
  readonly policy: Policy;
  private daySpentSol = 0;
  private lastTradeTs = -Infinity; // "no prior trade" → first trade never hits cooldown
  private day = '';
  private readonly now: () => number;

  constructor(o: MockCustodyOptions = {}) {
    this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...o.policy, paper: true });
    this.address = o.address ?? null;
    this.now = o.now ?? Date.now;
  }

  async intent(intent: Intent): Promise<IntentResult> {
    const kind: IntentKind | undefined = intent.kind;
    if (kind !== 'buy' && kind !== 'sell') return reject('bad-intent', 'kind must be buy|sell');
    if (!this.policy.allow.includes(kind)) return reject('action-not-allowed', `${kind} not allowed by policy`);
    if (intent.token && this.policy.denyTokens.includes(intent.token))
      return reject('token-denied', 'token denied by policy');
    if (intent.token && this.policy.allowTokens && !this.policy.allowTokens.includes(intent.token))
      return reject('token-not-allowed', 'token not in allowlist');

    const t = this.now();
    const since = t - this.lastTradeTs;
    if (since < this.policy.cooldownMs) return reject('cooldown', `cooldown ${this.policy.cooldownMs - since}ms remaining`);

    const d = utcDay(t);
    if (this.day !== d) {
      this.day = d;
      this.daySpentSol = 0;
    }
    const sizeSol = Number(intent.sizeSol);
    if (!(sizeSol > 0)) return reject('bad-intent', 'sizeSol must be > 0');
    if (sizeSol > this.policy.maxNotionalSol)
      return reject('over-trade-cap', `size ${sizeSol} > maxNotionalSol ${this.policy.maxNotionalSol}`);
    if (this.daySpentSol + sizeSol > this.policy.maxDailySol)
      return reject('over-daily-cap', `daily ${this.daySpentSol.toFixed(4)}+${sizeSol} > ${this.policy.maxDailySol}`);

    this.daySpentSol += sizeSol;
    this.lastTradeTs = t;
    return {
      ok: true,
      code: 'paper-local',
      signature: null,
      paper: true,
      submitted: false,
      daySpentSol: +this.daySpentSol.toFixed(6),
      address: this.address ?? undefined,
    };
  }

  buy(token: string, sizeSol: number, opts: Partial<Intent> = {}): Promise<IntentResult> {
    return this.intent({ kind: 'buy', token, sizeSol, ...opts });
  }
  sell(token: string, opts: SellOpts = {}): Promise<IntentResult> {
    return this.intent({ kind: 'sell', token, ...opts });
  }
}

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
import { decisionGate, type Rule, type VerifiedIntent } from '@circuit/attest';

export interface SellOpts {
  /** SOL notional (paper sells). */
  sizeSol?: number;
  /** Token base units (live sells). */
  amount?: number;
  maxSlippageBps?: number;
}

export interface Custody {
  readonly kind: 'offbox-signer' | 'local' | 'vault';
  readonly address: string | null;
  readonly paper: boolean;
  /** Submit a raw intent. Resolves to a signed result or a rejection (never throws). */
  intent(intent: Intent): Promise<IntentResult>;
  buy(token: string, sizeSol: number, opts?: Partial<Intent>): Promise<IntentResult>;
  sell(token: string, opts?: SellOpts): Promise<IntentResult>;
  /** Verified-intent path (docs/VERIFIED_INTENTS.md): submit a trade + the authenticated
   *  evidence + the rule that justifies it. The signer (or MockCustody) re-runs the decision
   *  gate and signs only if the inputs + rule actually produce this trade. Optional — present
   *  when the agent runs in verified mode. */
  verifiedIntent?(vi: VerifiedIntent): Promise<IntentResult>;
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

  async verifiedIntent(vi: VerifiedIntent): Promise<IntentResult> {
    try {
      const res = await this.fetchImpl(`${this.base}/v1/agents/${this.agentId}/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          epoch: this.epoch,
          token: this.session,
          intent: vi.intent,
          rule: vi.rule,
          inputs: vi.inputs,
          evidence: vi.evidence,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const j = (await res.json().catch(() => ({}))) as Partial<IntentResult>;
      if (res.ok) return { ...j, ok: true, code: j.code ?? 'verified' };
      return { ok: false, code: j.code ?? `http-${res.status}`, error: j.error };
    } catch (e) {
      return { ok: false, code: 'signer-unreachable', error: (e as Error).message };
    }
  }
}

// ── shared policy engine ──────────────────────────────────────────────────────

const utcDay = (t: number): string => new Date(t).toISOString().slice(0, 10);
const reject = (code: string, error: string): IntentResult => ({ ok: false, code, error });

/** A rejection (ok:false) or an admission (ok:true) carrying the post-trade daily spend. */
export type Admission =
  | { ok: false; code: string; error: string }
  | { ok: true; sizeSol: number; daySpentSol: number };

/** The owner's trading policy as a stateful gate — the single source of truth shared by every
 *  paper/local/vault custody, so they ALL reject identically (and match the off-box signer's codes).
 *  `admit()` checks an intent against the policy and, on success, advances the cooldown + daily-spend
 *  state. The vault enforces the fund-safety caps ON-CHAIN too; this is the fast-fail mirror. */
export class PolicyEngine {
  readonly policy: Policy;
  private daySpentSol = 0;
  private lastTradeTs = -Infinity; // "no prior trade" → first trade never hits cooldown
  private day = '';
  private readonly now: () => number;

  constructor(policy: Policy, now: () => number = Date.now) {
    this.policy = policy;
    this.now = now;
  }

  get spentToday(): number {
    return +this.daySpentSol.toFixed(6);
  }

  admit(intent: Intent): Admission {
    const kind: IntentKind | undefined = intent.kind;
    if (kind !== 'buy' && kind !== 'sell') return { ok: false, code: 'bad-intent', error: 'kind must be buy|sell' };
    if (!this.policy.allow.includes(kind)) return { ok: false, code: 'action-not-allowed', error: `${kind} not allowed by policy` };
    if (intent.token && this.policy.denyTokens.includes(intent.token))
      return { ok: false, code: 'token-denied', error: 'token denied by policy' };
    if (intent.token && this.policy.allowTokens && !this.policy.allowTokens.includes(intent.token))
      return { ok: false, code: 'token-not-allowed', error: 'token not in allowlist' };

    const t = this.now();
    const since = t - this.lastTradeTs;
    if (since < this.policy.cooldownMs) return { ok: false, code: 'cooldown', error: `cooldown ${this.policy.cooldownMs - since}ms remaining` };

    const d = utcDay(t);
    if (this.day !== d) {
      this.day = d;
      this.daySpentSol = 0;
    }
    const sizeSol = Number(intent.sizeSol);
    if (!(sizeSol > 0)) return { ok: false, code: 'bad-intent', error: 'sizeSol must be > 0' };
    if (sizeSol > this.policy.maxNotionalSol)
      return { ok: false, code: 'over-trade-cap', error: `size ${sizeSol} > maxNotionalSol ${this.policy.maxNotionalSol}` };
    if (this.daySpentSol + sizeSol > this.policy.maxDailySol)
      return { ok: false, code: 'over-daily-cap', error: `daily ${this.daySpentSol.toFixed(4)}+${sizeSol} > ${this.policy.maxDailySol}` };

    this.daySpentSol += sizeSol;
    this.lastTradeTs = t;
    return { ok: true, sizeSol, daySpentSol: this.spentToday };
  }
}

// ── local mock (paper) ──────────────────────────────────────────────────────

export interface MockCustodyOptions {
  address?: string | null;
  policy?: Partial<Policy>;
  now?: () => number;
  /** Verified-intent mode: the committed decision rule + the producer keys the gate trusts.
   *  When set, verifiedIntent() re-runs the same decision gate the real signer runs. */
  rule?: Rule;
  acceptedKeys?: Record<string, 'data' | 'inference'>;
  evidenceMaxAgeMs?: number;
}

/** Paper trading with the signer's policy semantics — same rejection codes, so an
 *  agent that works against MockCustody works against the real signer. */
export class MockCustody implements Custody {
  readonly kind = 'local' as const;
  readonly address: string | null;
  readonly paper = true;
  readonly policy: Policy;
  private readonly engine: PolicyEngine;
  private readonly now: () => number;
  private readonly rule?: Rule;
  private readonly acceptedKeys: Record<string, 'data' | 'inference'>;
  private readonly evidenceMaxAgeMs?: number;

  constructor(o: MockCustodyOptions = {}) {
    this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...o.policy, paper: true });
    this.address = o.address ?? null;
    this.now = o.now ?? Date.now;
    this.engine = new PolicyEngine(this.policy, this.now);
    this.rule = o.rule;
    this.acceptedKeys = o.acceptedKeys ?? {};
    this.evidenceMaxAgeMs = o.evidenceMaxAgeMs;
  }

  /** Re-run the SAME decision gate the real signer runs (so dev == cloud), then apply
   *  the policy caps. Rejects a forged trade with the gate's code. */
  async verifiedIntent(vi: VerifiedIntent): Promise<IntentResult> {
    if (!this.rule) return reject('no-rule', 'MockCustody has no committed rule');
    const g = decisionGate(vi, {
      rule: this.rule,
      acceptedKeys: this.acceptedKeys,
      now: this.now,
      maxAgeMs: this.evidenceMaxAgeMs,
    });
    if (!g.ok) return { ok: false, code: g.code };
    return this.intent(vi.intent as Intent); // verified → still subject to policy caps
  }

  async intent(intent: Intent): Promise<IntentResult> {
    const a = this.engine.admit(intent);
    if (!a.ok) return reject(a.code, a.error);
    return {
      ok: true,
      code: 'paper-local',
      signature: null,
      paper: true,
      submitted: false,
      daySpentSol: a.daySpentSol,
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

// ── on-chain vault (non-custodial) ────────────────────────────────────────────

/** Executes a guarded vault trade on-chain. Injected so circuit-sdk stays free of a web3/program
 *  dependency: the concrete executor (Jupiter route + circuit-agent-vault VaultClient.trade(),
 *  signed by the delegate key on THIS host) lives where both are available (the CLI / host adapter).
 *  The delegate key it signs with can ONLY trade — never withdraw — so the worst a tampered host can
 *  do is a bad-but-bounded swap; the on-chain guard makes theft impossible. When `vi` is present the
 *  executor attaches the Ed25519 oracle attestation (the vault's on-chain Verified-Intents proof). */
export interface VaultTradeExecutor {
  execute(intent: Intent, vi?: VerifiedIntent): Promise<{ signature: string; solValue?: number }>;
}

export interface VaultCustodyOptions {
  /** The vault PDA, for display/heartbeat. */
  address?: string | null;
  policy?: Partial<Policy>;
  /** false → submit trades on-chain via `executor`; true → paper-trade locally (default true). */
  paper?: boolean;
  /** Required when paper=false: lands the guarded trade on-chain. */
  executor?: VaultTradeExecutor;
  /** Verified-intent mode: the off-chain pre-gate (the CHAIN is the real enforcement — the vault's
   *  committed rule + Ed25519 attestation; this fails fast and keeps dev == prod). */
  rule?: Rule;
  acceptedKeys?: Record<string, 'data' | 'inference'>;
  evidenceMaxAgeMs?: number;
  now?: () => number;
}

/**
 * Non-custodial custody: trades run through the on-chain Agent Vault (circuit-agent-vault). The agent
 * holds only the DELEGATE key (trade-only); the owner — whose key Circuit never sees — is the sole
 * withdraw authority. Same Custody interface as the signer, so the strategy code is unchanged; the
 * difference is where trust lives: a program invariant, not a trusted server. Policy is enforced here
 * (fast-fail, identical codes to MockCustody/signer) AND on-chain (the authoritative boundary).
 */
export class VaultCustody implements Custody {
  readonly kind = 'vault' as const;
  readonly address: string | null;
  readonly paper: boolean;
  readonly policy: Policy;
  private readonly engine: PolicyEngine;
  private readonly executor?: VaultTradeExecutor;
  private readonly now: () => number;
  private readonly rule?: Rule;
  private readonly acceptedKeys: Record<string, 'data' | 'inference'>;
  private readonly evidenceMaxAgeMs?: number;

  constructor(o: VaultCustodyOptions = {}) {
    this.paper = o.paper ?? true;
    this.policy = normalizePolicy({ ...DEFAULT_POLICY, ...o.policy, paper: this.paper });
    this.address = o.address ?? null;
    this.now = o.now ?? Date.now;
    this.engine = new PolicyEngine(this.policy, this.now);
    this.executor = o.executor;
    this.rule = o.rule;
    this.acceptedKeys = o.acceptedKeys ?? {};
    this.evidenceMaxAgeMs = o.evidenceMaxAgeMs;
  }

  async intent(intent: Intent): Promise<IntentResult> {
    return this.run(intent);
  }

  /** Verified-intent path: the off-chain decision gate (mirrors the signer) THEN the on-chain trade,
   *  whose executor attaches the oracle attestation the vault verifies. Defense in depth — the chain
   *  refuses an off-rule trade regardless, but failing fast here avoids burning a transaction. */
  async verifiedIntent(vi: VerifiedIntent): Promise<IntentResult> {
    if (this.rule) {
      const g = decisionGate(vi, {
        rule: this.rule,
        acceptedKeys: this.acceptedKeys,
        now: this.now,
        maxAgeMs: this.evidenceMaxAgeMs,
      });
      if (!g.ok) return { ok: false, code: g.code };
    }
    return this.run(vi.intent as Intent, vi);
  }

  private async run(intent: Intent, vi?: VerifiedIntent): Promise<IntentResult> {
    const a = this.engine.admit(intent);
    if (!a.ok) return reject(a.code, a.error);
    if (this.paper) {
      return { ok: true, code: 'paper-local', signature: null, paper: true, submitted: false, daySpentSol: a.daySpentSol, address: this.address ?? undefined };
    }
    if (!this.executor) return reject('no-executor', 'VaultCustody is live (paper=false) but no trade executor was provided');
    try {
      const { signature, solValue } = await this.executor.execute(intent, vi);
      return { ok: true, code: 'vault-trade', signature, txid: signature, submitted: true, paper: false, solValue, daySpentSol: a.daySpentSol, address: this.address ?? undefined };
    } catch (e) {
      return { ok: false, code: 'vault-trade-failed', error: (e as Error).message };
    }
  }

  buy(token: string, sizeSol: number, opts: Partial<Intent> = {}): Promise<IntentResult> {
    return this.intent({ kind: 'buy', token, sizeSol, ...opts });
  }
  sell(token: string, opts: SellOpts = {}): Promise<IntentResult> {
    return this.intent({ kind: 'sell', token, ...opts });
  }
}

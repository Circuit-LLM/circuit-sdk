// Custody — how an agent gets a trade authorized + signed. Four implementations, all sharing one
// PolicyEngine gate + rejection codes so the SAME agent behaves identically across every mode:
//   SignerCustody       — off-box signer (circuit-agent-cloud/signer): the agent holds only a scoped
//                         session token + epoch (the fence); the KEY never touches this host. POST
//                         /v1/agents/{id}/intent → signed attestation or a rejection code. The mesh default.
//   MockCustody         — local paper trading, no signer (dev/CI).
//   LocalKeypairCustody — self-custody: signs locally with your own keypair via an injected executor
//                         (holds a withdraw-capable key → only for hardware you control).
//   VaultCustody        — non-custodial: trades run through the on-chain Agent Vault; the owner is the
//                         sole withdraw authority. LocalKeypairCustody + VaultCustody share ExecutorCustody.

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
  readonly kind: 'offbox-signer' | 'local' | 'local-keypair' | 'vault';
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
  | { ok: true; sizeSol: number; daySpentSol: number; prevTradeTs: number };

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

    const prevTradeTs = this.lastTradeTs;
    this.daySpentSol += sizeSol;
    this.lastTradeTs = t;
    return { ok: true, sizeSol, daySpentSol: this.spentToday, prevTradeTs };
  }

  /** Undo an admission whose trade did NOT execute (e.g. the on-chain submit threw) — restore the daily
   *  spend + cooldown so a transient failure doesn't eat the day's budget or impose a false cooldown. */
  revert(adm: { sizeSol: number; prevTradeTs: number }): void {
    this.daySpentSol = Math.max(0, this.daySpentSol - adm.sizeSol);
    this.lastTradeTs = adm.prevTradeTs;
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

// ── executor-backed custody (shared base: vault + local keypair) ──────────────

/** Lands a buy/sell and returns its signature. Injected so @circuit/agent stays free of a web3/program
 *  dependency — the concrete executor (Jupiter route + signing) lives where web3 is available:
 *  `walletTradeExecutor` (@circuit/wallet) for a local keypair, or the CLI/host adapter's vault
 *  executor. When `vi` is present the executor may attach the Ed25519 oracle attestation (the vault's
 *  on-chain Verified-Intents proof). */
export interface TradeExecutor {
  execute(intent: Intent, vi?: VerifiedIntent): Promise<{ signature: string; solValue?: number }>;
}
/** @deprecated Alias of {@link TradeExecutor}, kept for back-compat. */
export type VaultTradeExecutor = TradeExecutor;

export interface ExecutorCustodyOptions {
  /** The wallet / vault address, for display + heartbeat. */
  address?: string | null;
  policy?: Partial<Policy>;
  /** false → sign + submit real trades via `executor`; true → paper-trade locally (default true). */
  paper?: boolean;
  /** Required when paper=false: lands the trade (signs + sends). */
  executor?: TradeExecutor;
  /** Verified-intent pre-gate: re-run the committed rule on authenticated inputs before executing
   *  (same decision gate as the signer; fast-fails an off-rule trade and keeps dev == prod). */
  rule?: Rule;
  acceptedKeys?: Record<string, 'data' | 'inference'>;
  evidenceMaxAgeMs?: number;
  now?: () => number;
}
export type VaultCustodyOptions = ExecutorCustodyOptions;
export type LocalKeypairCustodyOptions = ExecutorCustodyOptions;

/**
 * Shared base for custody that authorizes locally (PolicyEngine) then delegates execution to an
 * injected {@link TradeExecutor}. The concrete modes differ only in WHERE the executor signs and the
 * success code: {@link VaultCustody} (on-chain guard, non-custodial) and {@link LocalKeypairCustody}
 * (self-custody). Policy gate + rejection codes are identical to MockCustody/signer, so the same
 * strategy code runs unchanged across every custody mode.
 */
export abstract class ExecutorCustody implements Custody {
  abstract readonly kind: Custody['kind'];
  /** Success code for a landed trade; the failure code is `${tradeCode}-failed`. */
  protected abstract readonly tradeCode: string;
  readonly address: string | null;
  readonly paper: boolean;
  readonly policy: Policy;
  private readonly engine: PolicyEngine;
  private readonly executor?: TradeExecutor;
  private readonly now: () => number;
  private readonly rule?: Rule;
  private readonly acceptedKeys: Record<string, 'data' | 'inference'>;
  private readonly evidenceMaxAgeMs?: number;

  constructor(o: ExecutorCustodyOptions = {}) {
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

  /** Verified-intent path: re-run the committed rule on authenticated inputs (defense in depth with
   *  the authoritative on-chain check), then execute — passing the full `vi` so a vault executor can
   *  attach the oracle attestation. */
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
    if (!this.executor) return reject('no-executor', `${this.kind} custody is live (paper=false) but no trade executor was provided`);
    try {
      const { signature, solValue } = await this.executor.execute(intent, vi);
      return { ok: true, code: this.tradeCode, signature, txid: signature, submitted: true, paper: false, solValue, daySpentSol: a.daySpentSol, address: this.address ?? undefined };
    } catch (e) {
      this.engine.revert(a); // the trade never landed — don't let it consume the day's budget/cooldown
      return { ok: false, code: `${this.tradeCode}-failed`, error: (e as Error).message };
    }
  }

  buy(token: string, sizeSol: number, opts: Partial<Intent> = {}): Promise<IntentResult> {
    return this.intent({ kind: 'buy', token, sizeSol, ...opts });
  }
  sell(token: string, opts: SellOpts = {}): Promise<IntentResult> {
    return this.intent({ kind: 'sell', token, ...opts });
  }
}

// ── on-chain vault (non-custodial) ────────────────────────────────────────────

/**
 * Non-custodial custody: trades run through the on-chain Agent Vault (circuit-agent-vault). The agent
 * holds only the DELEGATE key (trade-only); the owner — whose key Circuit never sees — is the sole
 * withdraw authority. Trust lives in a program invariant, not a trusted server. `executor` = Jupiter
 * route + `VaultClient.trade()`; pass a `rule` to fast-fail an off-rule trade before burning a tx.
 */
export class VaultCustody extends ExecutorCustody {
  readonly kind = 'vault' as const;
  protected readonly tradeCode = 'vault-trade';
}

// ── local keypair (self-custody, your own trusted box) ────────────────────────

/**
 * Self-custody: trades are signed LOCALLY with your own keypair (via an injected executor — typically
 * `walletTradeExecutor` from @circuit/wallet). The simplest real-trading path for an agent on hardware
 * YOU control — no signer, no vault. Same gate + rejection codes as every other mode, so identical
 * strategy code runs paper → local-keypair → signer → vault unchanged.
 *
 * ⚠ Unlike the signer/vault, this holds a withdraw-capable key on the host — only appropriate on a
 * machine you control, never on the mesh (there the off-box signer or the on-chain vault is correct).
 */
export class LocalKeypairCustody extends ExecutorCustody {
  readonly kind = 'local-keypair' as const;
  protected readonly tradeCode = 'local-trade';
}

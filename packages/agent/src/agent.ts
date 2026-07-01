// CircuitAgent — the base class you extend to write an agent that runs on Circuit's
// CPU mesh. It owns the whole agentd contract (env wiring, off-box custody, heartbeat,
// logs, SIGTERM lifecycle) so you write only strategy: setup() + tick().
//
//   class MyBot extends CircuitAgent {
//     async tick() { const sig = await this.analyze(); if (sig.buy) await this.buy(sig.mint, sig.sol); }
//   }
//   new MyBot().run();
//
// Custody is off-box: this.buy/this.sell go to the signer, which holds the key and
// enforces buy/sell-only policy + the epoch fence. Locally (no signer) a MockCustody
// paper-trades with identical semantics. NOTE: paying for inference/data uses a
// SEPARATE owner-funded payment wallet (this.inference({ wallet })), never the
// off-box trading wallet — that one can only buy/sell, never transfer.

import nodeFs from 'node:fs';
import { join } from 'node:path';
import { Inference, type InferenceOptions } from '@circuit-llm/inference';
import { Data, type DataOptions } from '@circuit-llm/data';
import {
  type AgentContext,
  type AgentState,
  type Heartbeat,
  type Intent,
  type IntentResult,
  type Policy,
  type Position,
} from './types.ts';
import { type Custody, LocalKeypairCustody, MockCustody, SignerCustody, type TradeExecutor, type SellOpts } from './custody.ts';
import { evaluateRule, type Evidence, type Rule, type RuleInputs, type VerifiedIntent } from '@circuit-llm/attest';

/** The slice of fs the agent uses — injectable for tests. */
export interface FsLike {
  readFileSync(path: string, enc: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  appendFileSync(path: string, data: string): void;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
}

export interface AgentOptions {
  name?: string;
  /** tick interval (ms); default config.scanIntervalMs or 5000. */
  intervalMs?: number;
  /** Override the env-derived context (tests). */
  context?: Partial<AgentContext>;
  env?: NodeJS.ProcessEnv;
  /** Inject a custody (tests / explicit). Otherwise derived: SignerCustody if signerUrl (mesh), else
   *  LocalKeypairCustody if `executor` is set (self-custody on your box), else MockCustody (paper). */
  custody?: Custody;
  /** Self-custody executor (e.g. walletTradeExecutor from @circuit-llm/wallet). When set and there is no
   *  signerUrl, the agent trades locally with your keypair — paper unless CIRCUIT_AGENT_PAPER=0. */
  executor?: TradeExecutor;
  /** Local policy for MockCustody / LocalKeypairCustody when there's no signer. */
  policy?: Partial<Policy>;
  /** Verified-intent mode (docs/VERIFIED_INTENTS.md): the owner-committed decision rule, the
   *  producer keys the gate trusts, and the evidence freshness window. Enables this.verifiedTrade(). */
  rule?: Rule;
  acceptedKeys?: Record<string, 'data' | 'inference'>;
  evidenceMaxAgeMs?: number;
  fs?: FsLike;
  now?: () => number;
  /** Process-exit hook (tests inject a no-op). */
  onExit?: (code: number) => void;
  /** Log sink (tests inject to silence stdout). */
  print?: (line: string) => void;
}

export function resolveContext(opts: Pick<AgentOptions, 'context' | 'env' | 'name'> = {}): AgentContext {
  const e = opts.env ?? process.env;
  const c = opts.context ?? {};
  return {
    dataDir: c.dataDir ?? e.CIRCUIT_AGENT_DATA_DIR ?? process.cwd(),
    name: opts.name ?? c.name ?? e.AGENT_NAME ?? 'agent',
    signerUrl: c.signerUrl ?? e.CIRCUIT_SIGNER_URL ?? '',
    agentId: c.agentId ?? e.CIRCUIT_AGENT_ID ?? '',
    epoch: c.epoch ?? Number(e.CIRCUIT_AGENT_EPOCH ?? 0),
    session: c.session ?? e.CIRCUIT_AGENT_SESSION ?? '',
    address: c.address ?? e.CIRCUIT_AGENT_ADDRESS ?? null,
    paper: c.paper ?? (e.CIRCUIT_AGENT_PAPER ? e.CIRCUIT_AGENT_PAPER !== '0' : true),
  };
}

export abstract class CircuitAgent {
  readonly ctx: AgentContext;
  readonly custody: Custody;
  /** Owner-committed decision rule (verified-intent mode); enables verifiedTrade(). */
  readonly rule?: Rule;

  /** Strategy-owned mutable state surfaced in the heartbeat. */
  protected config: Record<string, unknown> = {};
  protected scans = 0;
  protected pnlPct = 0;
  protected positions: Position[] = [];
  protected signedTrades = 0;

  private readonly fs: FsLike;
  private readonly now: () => number;
  private readonly onExit: (code: number) => void;
  private readonly print: (line: string) => void;
  private readonly logFile: string;
  private readonly hbFile: string;
  private readonly configFile: string;
  private readonly started: number;
  private intervalMs: number;
  private running = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(opts: AgentOptions = {}) {
    this.ctx = resolveContext(opts);
    this.fs = opts.fs ?? (nodeFs as unknown as FsLike);
    this.now = opts.now ?? Date.now;
    this.onExit = opts.onExit ?? ((c) => process.exit(c));
    this.print = opts.print ?? ((line) => void process.stdout.write(line));
    this.custody =
      opts.custody ??
      (this.ctx.signerUrl
        ? new SignerCustody({
            signerUrl: this.ctx.signerUrl,
            agentId: this.ctx.agentId,
            epoch: this.ctx.epoch,
            session: this.ctx.session,
            address: this.ctx.address,
            paper: this.ctx.paper,
          })
        : opts.executor
          ? new LocalKeypairCustody({
              executor: opts.executor,
              address: this.ctx.address,
              paper: this.ctx.paper,
              policy: opts.policy,
              rule: opts.rule,
              acceptedKeys: opts.acceptedKeys,
              evidenceMaxAgeMs: opts.evidenceMaxAgeMs,
            })
          : new MockCustody({
              address: this.ctx.address,
              policy: opts.policy,
              rule: opts.rule,
              acceptedKeys: opts.acceptedKeys,
              evidenceMaxAgeMs: opts.evidenceMaxAgeMs,
            }));
    this.rule = opts.rule;
    this.logFile = join(this.ctx.dataDir, 'agent.log');
    this.hbFile = join(this.ctx.dataDir, 'heartbeat.json');
    this.configFile = join(this.ctx.dataDir, 'config.json');
    this.started = this.now();
    this.intervalMs = opts.intervalMs ?? 0;
  }

  // ── override points ────────────────────────────────────────────────────────
  /** One-time setup before the loop (read config, connect, etc.). */
  setup(): void | Promise<void> {}
  /** One strategy cycle. Called every intervalMs. */
  abstract tick(): void | Promise<void>;
  /** Node budget cut / reschedule — checkpoint gracefully. */
  onDrain(): void | Promise<void> {}
  /** Persist state on shutdown. */
  checkpoint(): void | Promise<void> {}
  /** Extra fields to merge into the heartbeat. */
  protected heartbeatExtra(): Record<string, unknown> {
    return {};
  }

  // ── strategy API ─────────────────────────────────────────────────────────
  /** Read + cache <dataDir>/config.json. */
  readConfig<T = Record<string, unknown>>(): T {
    try {
      const c = JSON.parse(this.fs.readFileSync(this.configFile, 'utf8')) as Record<string, unknown>;
      this.config = c;
      return c as T;
    } catch {
      return this.config as T;
    }
  }

  /** Append a line to <dataDir>/agent.log (the node-host tails it) + stdout. */
  log(msg: string): void {
    const line = `[${new Date(this.now()).toISOString()}] ${msg}\n`;
    try {
      this.fs.appendFileSync(this.logFile, line);
    } catch {
      /* logging must never throw */
    }
    this.print(line);
  }

  /** Authorize + sign a BUY via custody (off-box). Increments signedTrades on success. */
  async buy(token: string, sizeSol: number, opts: Partial<Intent> = {}): Promise<IntentResult> {
    const r = await this.custody.buy(token, sizeSol, opts);
    if (r.ok) this.signedTrades++;
    return r;
  }
  /** Authorize + sign a SELL via custody (off-box). */
  async sell(token: string, opts: SellOpts = {}): Promise<IntentResult> {
    const r = await this.custody.sell(token, opts);
    if (r.ok) this.signedTrades++;
    return r;
  }
  /** Submit a raw intent. */
  intent(i: Intent): Promise<IntentResult> {
    return this.custody.intent(i);
  }

  /** Verified-intent trade (docs/VERIFIED_INTENTS.md). Evaluate the owner-committed rule on
   *  AUTHENTICATED inputs; if it fires, submit the trade + evidence so the signer re-derives
   *  and signs it. Returns null when the rule produces no trade (no signal). The honest agent
   *  path — the signer rejects anything the rule + inputs don't justify, so even a tampered
   *  host can't get a forged trade signed. */
  async verifiedTrade(inputs: RuleInputs, evidence: Evidence[]): Promise<IntentResult | null> {
    if (!this.rule) throw new Error('verifiedTrade requires a committed rule (set options.rule)');
    const intent = evaluateRule(this.rule, inputs);
    if (!intent) return null; // no signal — nothing to trade
    const vi: VerifiedIntent = { intent, rule: this.rule.id, inputs, evidence };
    const r = this.custody.verifiedIntent
      ? await this.custody.verifiedIntent(vi)
      : await this.custody.intent(intent as Intent);
    if (r.ok) this.signedTrades++;
    return r;
  }

  /** Pre-wired inference client. Pass `{ wallet }` (an owner-funded PAYMENT wallet,
   *  NOT the trading custody wallet) to use paid inference. */
  inference(opts: InferenceOptions = {}): Inference {
    return new Inference(opts);
  }
  /** Pre-wired data client. Same payment note as inference(). */
  data(opts: DataOptions = {}): Data {
    return new Data(opts);
  }

  /** Write <dataDir>/heartbeat.json — the node-host forwards it to the control plane. */
  heartbeat(state: AgentState): void {
    const hb: Heartbeat = {
      ts: this.now(),
      state,
      name: this.ctx.name,
      uptimeS: Math.round((this.now() - this.started) / 1000),
      scans: this.scans,
      pnlPct: +this.pnlPct.toFixed(2),
      positions: this.positions,
      paper: this.ctx.paper,
      custody: this.custody.kind,
      address: this.ctx.address ?? undefined,
      signedTrades: this.signedTrades,
      ...this.heartbeatExtra(),
    };
    try {
      this.fs.writeFileSync(this.hbFile, JSON.stringify(hb));
    } catch {
      /* heartbeat must never throw */
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  /** Boot: ensure dataDir, read config, call setup(), mark running. No timer. */
  async start(): Promise<void> {
    try {
      this.fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    this.readConfig();
    if (!this.intervalMs) this.intervalMs = Number(this.config.scanIntervalMs) || 5000;
    this.log(
      `agent up — name=${this.ctx.name} custody=${this.custody.kind} paper=${this.ctx.paper}` +
        (this.ctx.address ? ` wallet=${this.ctx.address} epoch=${this.ctx.epoch}` : ''),
    );
    await this.setup();
    this.running = true;
    this.heartbeat('running');
  }

  /** Run exactly one tick (used by the loop; call directly in tests). */
  async runTick(): Promise<void> {
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      this.scans++;
      await this.tick();
      this.heartbeat('running');
    } catch (e) {
      this.log(`tick error: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  /** Graceful shutdown: drain + checkpoint + final heartbeat + exit. */
  async stop(reason = 'stop'): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.log(`${reason} — checkpointing and exiting`);
    try {
      await this.onDrain();
      await this.checkpoint();
    } catch (e) {
      this.log(`drain error: ${(e as Error).message}`);
    }
    this.heartbeat('stopped');
    this.onExit(0);
  }

  /** Production entry: start, run the loop, wire SIGTERM/SIGINT → stop. */
  async run(): Promise<void> {
    await this.start();
    this.timer = setInterval(() => void this.runTick(), this.intervalMs);
    const onSig = (s: string) => () => void this.stop(s);
    process.on('SIGTERM', onSig('SIGTERM'));
    process.on('SIGINT', onSig('SIGINT'));
  }
}

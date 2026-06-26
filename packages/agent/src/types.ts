// Agent-cloud protocol types. Mirrors circuit-agent-cloud (lib/proto.js, agentd/agentd.js,
// signer/server.js) so a CircuitAgent speaks the exact wire contract the cloud expects.

export type IntentKind = 'buy' | 'sell';

/** A trade request submitted to the off-box signer. Only buy|sell exist — there is
 *  NO transfer/withdraw, so value can never leave the agent wallet autonomously. */
export interface Intent {
  kind: IntentKind;
  /** Token mint to trade. */
  token?: string;
  /** SOL notional (buys, and paper sells). Capped per-trade + per-day by policy. */
  sizeSol?: number;
  /** Token base units (live sells only). */
  amount?: number;
  maxSlippageBps?: number;
}

/** The signer's reply: a signed attestation (paper) or a landed swap (live), or a
 *  rejection code (fenced | cooldown | over-trade-cap | token-denied | …). */
export interface IntentResult {
  ok: boolean;
  code: string;
  signature?: string | null;
  address?: string;
  paper?: boolean;
  submitted?: boolean;
  txid?: string;
  status?: string;
  solValue?: number;
  daySpentSol?: number;
  error?: string;
  attestation?: { canonical: string };
}

/** The owner's trading limits — enforced by the signer (and mirrored by MockCustody). */
export interface Policy {
  maxNotionalSol: number;
  maxDailySol: number;
  cooldownMs: number;
  allow: IntentKind[];
  denyTokens: string[];
  allowTokens: string[] | null;
  paper: boolean;
}

export const DEFAULT_POLICY: Policy = {
  maxNotionalSol: 0.05,
  maxDailySol: 0.5,
  cooldownMs: 30_000,
  allow: ['buy', 'sell'],
  denyTokens: [],
  allowTokens: null,
  paper: true,
};

export function normalizePolicy(p: Partial<Policy> = {}): Policy {
  const n: Policy = { ...DEFAULT_POLICY, ...p };
  n.maxNotionalSol = Math.max(0, Number(n.maxNotionalSol) || 0);
  n.maxDailySol = Math.max(n.maxNotionalSol, Number(n.maxDailySol) || 0);
  n.cooldownMs = Math.max(0, Number(n.cooldownMs) || 0);
  n.allow = (Array.isArray(n.allow) ? n.allow : ['buy', 'sell']).filter(
    (k): k is IntentKind => k === 'buy' || k === 'sell',
  );
  n.denyTokens = Array.isArray(n.denyTokens) ? n.denyTokens : [];
  n.allowTokens = Array.isArray(n.allowTokens) ? n.allowTokens : null;
  n.paper = n.paper !== false;
  return n;
}

/** Control-plane agent lifecycle states. */
export const STATE = {
  PENDING: 'pending',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  FAILED: 'failed',
} as const;

export type AgentState = string;

/** Runtime context handed to a workload by the node-host (read from env). */
export interface AgentContext {
  dataDir: string;
  name: string;
  /** Off-box signer base URL; empty → run pure-paper locally (MockCustody). */
  signerUrl: string;
  agentId: string;
  /** Monotonic session epoch — the fence. */
  epoch: number;
  /** Scoped session token (NOT a key). */
  session: string;
  address: string | null;
  paper: boolean;
}

export interface Position {
  symbol: string;
  entryPnl?: number;
  sizeSol?: number;
  [k: string]: unknown;
}

/** The heartbeat.json the node-host tails + forwards to the control plane. */
export interface Heartbeat {
  ts: number;
  state: AgentState;
  name: string;
  uptimeS: number;
  scans: number;
  pnlPct: number;
  positions: Position[];
  paper: boolean;
  custody: 'offbox-signer' | 'local' | 'vault';
  address?: string;
  signedTrades: number;
  [k: string]: unknown;
}

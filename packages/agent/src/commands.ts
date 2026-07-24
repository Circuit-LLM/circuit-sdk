// Command Inbox (circuit-agent-cloud/docs/COMMAND_INBOX.md) — the owner→agent control
// primitive. An owner signs a command with their wallet key; the agent verifies it
// end-to-end against the owner pubkey it was provisioned with. The control-plane only
// RELAYS — authenticity is the owner's signature over the canonical command bytes, never
// the transport. Reuses @circuit-llm/attest's ed25519-over-stableStringify (the same
// canonical scheme the rest of the stack signs with); no new crypto is introduced.
import { signPayload, verifyPayload, attestSignerFromSeed } from '@circuit-llm/attest';

export type CommandType = 'config-patch' | 'action';

export interface Command {
  agentId: string;
  /** owner-chosen, strictly monotonic per agent — the replay fence (like the vault's
   *  last_attestation_ts). Not CP-assigned, so the owner can sign it before submitting. */
  seq: number;
  id: string; // unique idempotency key
  type: CommandType;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
  /** ed25519(owner) over the canonical signing fields below. */
  ownerSig: string;
}

// The exact fields covered by ownerSig — everything EXCEPT the signature itself. Field
// order is irrelevant to the bytes (stableStringify sorts keys), but the SET must match
// on both ends, so it lives in one place.
export type CommandSigningFields = Omit<Command, 'ownerSig'>;

export function signingFields(c: Command | CommandSigningFields): CommandSigningFields {
  const { agentId, seq, id, type, payload, createdAt, expiresAt } = c as Command;
  return { agentId, seq, id, type, payload, createdAt, expiresAt };
}

/** Owner-side: sign a command with the wallet's ed25519 SEED (32 bytes, hex). The CLI
 *  derives this from a Solana secret key via `secretKey.slice(0, 32)`. */
export function signCommand(seedHex: string, fields: CommandSigningFields): string {
  return signPayload(attestSignerFromSeed(seedHex), fields);
}

/** Agent-side: verify a command against the owner's raw ed25519 pubkey (hex). Returns
 *  false on ANY tampering — the agent is the authoritative enforcer, not the CP. */
export function verifyCommand(ownerPubkeyHex: string, c: Command): boolean {
  if (!c || typeof c.ownerSig !== 'string') return false;
  try {
    return verifyPayload(ownerPubkeyHex, signingFields(c), c.ownerSig);
  } catch {
    return false;
  }
}

/** Per-agent replay fence: the high-water seq + the ids seen within the live window. */
export interface FenceState {
  lastSeq: number;
  seenIds: Set<string>;
}

export interface AcceptResult {
  ok: boolean;
  reason?: string;
}

/** The full accept decision for a config-patch, in one place so the agent and the tests
 *  share the exact predicate. Order is deliberate: cheap structural checks, then the
 *  signature, then the replay fence, then scope. Every rejection names its reason (the
 *  vault's "right-outcome-wrong-reason" lesson). */
export function acceptConfigPatch(
  c: Command,
  opts: { ownerPubkeyHex: string; now: number; fence: FenceState; schemaKeys: string[] },
): AcceptResult {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'malformed' };
  if (c.type !== 'config-patch') return { ok: false, reason: 'not-config-patch' };
  if (typeof c.seq !== 'number' || !c.id || typeof c.payload !== 'object' || c.payload === null) {
    return { ok: false, reason: 'malformed' };
  }
  // Signature BEFORE the fence: an unsigned/forged command must never advance state.
  if (!verifyCommand(opts.ownerPubkeyHex, c)) return { ok: false, reason: 'bad-signature' };
  if (typeof c.expiresAt !== 'number' || opts.now >= c.expiresAt) return { ok: false, reason: 'expired' };
  if (c.seq <= opts.fence.lastSeq) return { ok: false, reason: 'replayed-seq' };
  if (opts.fence.seenIds.has(c.id)) return { ok: false, reason: 'replayed-id' };
  const bad = Object.keys(c.payload).filter((k) => !opts.schemaKeys.includes(k));
  if (bad.length) return { ok: false, reason: `out-of-schema:${bad.join(',')}` };
  return { ok: true };
}

/** The accept decision for an imperative action (Phase 2). Same gate as a config-patch —
 *  structural → signature → freshness → replay fence — but scope is an ALLOWLIST OF ACTION
 *  NAMES (`payload.action`) rather than config keys. The caller runs this once-only and
 *  at-most-once (commit the fence + an 'attempted' ack BEFORE the side effect). */
export function acceptAction(
  c: Command,
  opts: { ownerPubkeyHex: string; now: number; fence: FenceState; actions: string[] },
): AcceptResult {
  if (!c || typeof c !== 'object') return { ok: false, reason: 'malformed' };
  if (c.type !== 'action') return { ok: false, reason: 'not-action' };
  if (typeof c.seq !== 'number' || !c.id || typeof c.payload !== 'object' || c.payload === null) {
    return { ok: false, reason: 'malformed' };
  }
  if (!verifyCommand(opts.ownerPubkeyHex, c)) return { ok: false, reason: 'bad-signature' };
  if (typeof c.expiresAt !== 'number' || opts.now >= c.expiresAt) return { ok: false, reason: 'expired' };
  if (c.seq <= opts.fence.lastSeq) return { ok: false, reason: 'replayed-seq' };
  if (opts.fence.seenIds.has(c.id)) return { ok: false, reason: 'replayed-id' };
  const action = (c.payload as { action?: unknown }).action;
  if (typeof action !== 'string' || !action) return { ok: false, reason: 'no-action-name' };
  if (!opts.actions.includes(action)) return { ok: false, reason: `action-not-allowed:${action}` };
  return { ok: true };
}

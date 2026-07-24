// Command Inbox (docs/COMMAND_INBOX.md) — build, sign, and send an owner→agent command.
//
// The command is signed with the OWNER wallet key over the exact same canonical bytes the
// agent verifies with (signCommand from @circuit-llm/agent), so a command the CLI produces
// always verifies end-to-end at the agent. The control-plane is only a relay + owner-auth
// gate; it never sees or needs the wallet's private key beyond the request signature.
import { randomUUID } from 'node:crypto';
import { signCommand } from '@circuit-llm/agent';
import { loadKeypair } from './solana.js';
import * as cloud from './drivers/cloud.js';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // a command the agent hasn't applied in 10m expires

/** Build + sign a config-patch command. `keypair` and `now` are injectable for tests;
 *  they default to the CLI wallet and the wall clock. Throws if no wallet is loaded. */
export function buildSignedCommand(agentId, payload, { keypair, seq, ttlMs = DEFAULT_TTL_MS, now = Date.now } = {}) {
  const kp = keypair ?? loadKeypair();
  if (!kp) throw new Error('no owner wallet loaded — set CIRCUIT_WALLET or a keystore to sign commands');
  const seedHex = Buffer.from(kp.secretKey.slice(0, 32)).toString('hex');
  const createdAt = now();
  const fields = {
    agentId,
    seq,
    id: randomUUID(),
    type: 'config-patch',
    payload,
    createdAt,
    expiresAt: createdAt + ttlMs,
  };
  return { ...fields, ownerSig: signCommand(seedHex, fields) };
}

/** The next monotonic seq for an agent: strictly above anything the CP has seen (acked,
 *  pending, or recently resolved). One status read, so concurrent CLIs don't collide. */
export function nextSeq(status) {
  const seqs = [
    status?.ackedSeq ?? 0,
    ...(status?.pending ?? []).map((p) => p.seq),
    ...(status?.recent ?? []).map((r) => r.seq),
  ];
  return Math.max(0, ...seqs) + 1;
}

/** Send a config-patch to a cloud agent: read the cursor, sign the next command, enqueue it. */
export async function sendConfigPatch(name, meta, payload, opts = {}) {
  const status = await cloud.commandStatus(name, meta).catch(() => null);
  const seq = nextSeq(status);
  const command = buildSignedCommand(meta.id, payload, { ...opts, seq });
  const res = await cloud.sendCommand(name, meta, command);
  return { ...res, seq, id: command.id };
}

/** Read the command status (pending / applied / rejected / expired) the owner can see. */
export async function commandStatus(name, meta) {
  return cloud.commandStatus(name, meta);
}

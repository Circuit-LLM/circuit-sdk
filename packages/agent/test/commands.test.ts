// Command Inbox T1 — the sign/verify/accept primitive (docs/COMMAND_INBOX.md §2, §5).
// Adversarial: a forged, replayed, expired, or out-of-scope command must be rejected,
// each with its exact reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateAttestSigner } from '@circuit-llm/attest';
import {
  signCommand,
  verifyCommand,
  signingFields,
  acceptConfigPatch,
  type Command,
  type CommandSigningFields,
  type FenceState,
} from '../src/commands.ts';

const owner = generateAttestSigner(); // { publicKey: hex, seed: hex }
const attacker = generateAttestSigner();

function mkCmd(over: Partial<CommandSigningFields> = {}): Command {
  const fields: CommandSigningFields = {
    agentId: 'agent-1',
    seq: 10,
    id: 'cmd-1',
    type: 'config-patch',
    payload: { topN: 5 },
    createdAt: 1_000,
    expiresAt: 2_000,
    ...over,
  };
  return { ...fields, ownerSig: signCommand(owner.seedHex, fields) };
}

const schemaKeys = ['topN', 'minChangePct', 'paused'];
const freshFence = (): FenceState => ({ lastSeq: 0, seenIds: new Set() });

test('roundtrip: a genuine command verifies', () => {
  assert.equal(verifyCommand(owner.pubkey, mkCmd()), true);
});

test('forgery: a different key cannot sign a command the owner accepts', () => {
  const fields = signingFields(mkCmd());
  const forged: Command = { ...fields, ownerSig: signCommand(attacker.seedHex, fields) };
  assert.equal(verifyCommand(owner.pubkey, forged), false);
});

test('tamper: mutating any signed field breaks the signature', () => {
  const c = mkCmd();
  assert.equal(verifyCommand(owner.pubkey, { ...c, payload: { topN: 999 } }), false);
  assert.equal(verifyCommand(owner.pubkey, { ...c, seq: 11 }), false);
  assert.equal(verifyCommand(owner.pubkey, { ...c, agentId: 'agent-2' }), false);
});

test('accept: happy path', () => {
  const r = acceptConfigPatch(mkCmd(), { ownerPubkeyHex: owner.pubkey, now: 1_500, fence: freshFence(), schemaKeys });
  assert.deepEqual(r, { ok: true });
});

test('accept: bad signature rejected before the fence advances', () => {
  const fields = signingFields(mkCmd());
  const forged: Command = { ...fields, ownerSig: signCommand(attacker.seedHex, fields) };
  const r = acceptConfigPatch(forged, { ownerPubkeyHex: owner.pubkey, now: 1_500, fence: freshFence(), schemaKeys });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-signature');
});

test('accept: expired rejected', () => {
  const r = acceptConfigPatch(mkCmd(), { ownerPubkeyHex: owner.pubkey, now: 2_000, fence: freshFence(), schemaKeys });
  assert.equal(r.reason, 'expired');
});

test('accept: replayed seq rejected (<= last applied)', () => {
  const r = acceptConfigPatch(mkCmd({ seq: 5 }), {
    ownerPubkeyHex: owner.pubkey, now: 1_500, fence: { lastSeq: 5, seenIds: new Set() }, schemaKeys,
  });
  assert.equal(r.reason, 'replayed-seq');
});

test('accept: replayed id rejected even with a fresh seq', () => {
  const r = acceptConfigPatch(mkCmd({ seq: 11, id: 'dup' }), {
    ownerPubkeyHex: owner.pubkey, now: 1_500, fence: { lastSeq: 3, seenIds: new Set(['dup']) }, schemaKeys,
  });
  assert.equal(r.reason, 'replayed-id');
});

test('accept: out-of-schema key rejected (scope allowlist)', () => {
  const r = acceptConfigPatch(mkCmd({ payload: { maxDailySol: 999 } }), {
    ownerPubkeyHex: owner.pubkey, now: 1_500, fence: freshFence(), schemaKeys,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /^out-of-schema:maxDailySol$/);
});

test('accept: wrong type rejected (config-patch only in Phase 1)', () => {
  const r = acceptConfigPatch(mkCmd({ type: 'action' }), {
    ownerPubkeyHex: owner.pubkey, now: 1_500, fence: freshFence(), schemaKeys,
  });
  assert.equal(r.reason, 'not-config-patch');
});

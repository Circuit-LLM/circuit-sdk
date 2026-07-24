// Command Inbox T5 — end-to-end composition (docs/COMMAND_INBOX.md). Wires the REAL
// control-plane queue (circuit-agent-cloud/lib/store.js) to the REAL CircuitAgent through a
// faithful relay (what the node-host does: fetch → commands.json; command-acks.json → ack).
// Proves the full owner→CP→relay→agent→ack→status loop, and the two composition cases the
// doc calls out: a withholding host is observable, and a reschedule is idempotent-safe.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CircuitAgent, type FsLike } from '../src/agent.ts';
import { MockCustody } from '../src/custody.ts';
import { generateAttestSigner } from '@circuit-llm/attest';
import { signCommand, type Command, type CommandSigningFields } from '../src/commands.ts';
// The REAL control-plane queue — same code the mesh runs (see command-inbox.test.mjs).
import { Store } from '../../../../circuit-agent-cloud/lib/store.js';

const owner = generateAttestSigner();
const AGENT = 'a1';

class MemFs implements FsLike {
  files = new Map<string, string>();
  readFileSync(p: string, _e: 'utf8'): string { const v = this.files.get(p); if (v == null) throw new Error('ENOENT'); return v; }
  writeFileSync(p: string, d: string): void { this.files.set(p, d); }
  appendFileSync(p: string, d: string): void { this.files.set(p, (this.files.get(p) ?? '') + d); }
  mkdirSync(): void {}
}
class NoopBot extends CircuitAgent { async tick(): Promise<void> {} }

function newStore(): any {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cmd-e2e-')), 's.json');
  return new Store(file);
}

function mkBot(dir: string) {
  const memfs = new MemFs();
  memfs.files.set(`${dir}/config.json`, JSON.stringify({ scanIntervalMs: 1000, topN: 3 }));
  const bot = new NoopBot({
    context: { dataDir: dir, name: 'bot' },
    custody: new MockCustody({ now: () => 0 }),
    fs: memfs, now: () => 5_000, onExit: () => {}, print: () => {},
  });
  return { bot, memfs };
}

// What the node-host does each beat: deliver pending → the agent's inbox file; relay acks
// back (skipped when the host withholds).
function relay(store: any, dir: string, memfs: MemFs, { forwardAcks = true } = {}): void {
  const commands = store.getCommands(AGENT, 0);
  memfs.files.set(`${dir}/commands.json`, JSON.stringify({ ownerPubkeyHex: owner.pubkey, commands }));
  if (forwardAcks) {
    try {
      const acks = JSON.parse(memfs.files.get(`${dir}/command-acks.json`) as string).acks;
      if (acks?.length) store.ackCommands(AGENT, acks);
    } catch { /* no acks yet */ }
  }
}

function ownerCmd(over: Partial<CommandSigningFields> = {}): Command {
  const f: CommandSigningFields = {
    agentId: AGENT, seq: 1, id: 'c1', type: 'config-patch',
    payload: { topN: 9 }, createdAt: 1_000, expiresAt: 10_000, ...over,
  };
  return { ...f, ownerSig: signCommand(owner.seedHex, f) };
}

test('roundtrip: owner enqueues → relay → agent applies → ack → CP status = applied', async () => {
  const store = newStore();
  const { bot, memfs } = mkBot('/d1');
  await bot.start();

  store.enqueueCommand(AGENT, ownerCmd());
  relay(store, '/d1', memfs);          // deliver
  await bot.runTick();                  // agent verifies + applies + acks
  relay(store, '/d1', memfs);          // relay the ack back

  assert.equal(JSON.parse(memfs.files.get('/d1/config.json')!).topN, 9, 'config applied at the agent');
  const st = store.commandStatus(AGENT);
  assert.equal(st.ackedSeq, 1, 'CP cursor advanced');
  assert.equal(st.pending.length, 0, 'no longer pending');
  assert.equal(st.recent.at(-1).result, 'applied', 'owner sees it applied');
});

test('withholding host is observable: agent applies, but a dropped ack leaves CP status pending', async () => {
  const store = newStore();
  const { bot, memfs } = mkBot('/d2');
  await bot.start();

  store.enqueueCommand(AGENT, ownerCmd());
  relay(store, '/d2', memfs);
  await bot.runTick();                          // agent applied it
  relay(store, '/d2', memfs, { forwardAcks: false }); // host withholds the ack

  assert.equal(JSON.parse(memfs.files.get('/d2/config.json')!).topN, 9, 'agent still applied it');
  const st = store.commandStatus(AGENT);
  assert.equal(st.ackedSeq, 0, 'CP never saw the ack');
  assert.equal(st.pending.length, 1, 'owner sees it stuck pending → can reschedule');
});

test('reschedule is idempotent-safe: a fresh agent instance re-applying an un-acked config-patch converges', async () => {
  const store = newStore();
  // Agent A applies, but its ack is withheld → the CP still has the command pending.
  const a = mkBot('/dA');
  await a.bot.start();
  store.enqueueCommand(AGENT, ownerCmd());
  relay(store, '/dA', a.memfs);
  await a.bot.runTick();
  relay(store, '/dA', a.memfs, { forwardAcks: false });
  assert.equal(store.commandStatus(AGENT).pending.length, 1, 'still pending at the CP');

  // Reschedule to a FRESH instance B (new dataDir, empty fence). It re-applies the still-
  // pending command — harmless for config-patch (latest-wins), so B converges to the same
  // config. (Strict once-only for imperative actions is a Phase 2 concern.)
  const b = mkBot('/dB');
  await b.bot.start();
  relay(store, '/dB', b.memfs);
  await b.bot.runTick();
  relay(store, '/dB', b.memfs); // B's ack propagates this time

  assert.equal(JSON.parse(b.memfs.files.get('/dB/config.json')!).topN, 9, 'B converged to the intended config');
  assert.equal(store.commandStatus(AGENT).ackedSeq, 1, 'resolved once B acked');
});

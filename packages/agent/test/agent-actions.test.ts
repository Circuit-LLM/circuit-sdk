// Command Inbox Phase 2 — imperative `action` commands (docs/COMMAND_INBOX.md §5, §6). An
// action runs at most once: the base commits the replay fence + persists an 'attempted' ack
// BEFORE the side effect, so a crash mid-action is never retried. Actions are allow-listed by
// name (commandActions), and a bad/forged/out-of-scope action is rejected with its reason.
import { test } from 'node:test';
import assert from 'node:assert';
import { CircuitAgent, type FsLike } from '../src/agent.ts';
import { MockCustody } from '../src/custody.ts';
import { generateAttestSigner } from '@circuit-llm/attest';
import { signCommand, type Command, type CommandSigningFields } from '../src/commands.ts';

const owner = generateAttestSigner();
const attacker = generateAttestSigner();
const NOW = 5_000;

class MemFs implements FsLike {
  files = new Map<string, string>();
  readFileSync(p: string, _e: 'utf8'): string { const v = this.files.get(p); if (v == null) throw new Error('ENOENT'); return v; }
  writeFileSync(p: string, d: string): void { this.files.set(p, d); }
  appendFileSync(p: string, d: string): void { this.files.set(p, (this.files.get(p) ?? '') + d); }
  mkdirSync(): void {}
}

// A bot that exposes one action, `ping`, and counts how many times it actually runs.
class ActionBot extends CircuitAgent {
  ran = 0;
  seenAttemptedAt = -1; // the persisted ack state observed at the moment onCommand ran
  behavior: 'ok' | 'throw' | 'fail' = 'ok';
  async tick(): Promise<void> {}
  protected commandActions(): string[] { return ['ping']; }
  protected async onCommand(cmd: Command): Promise<{ applied: boolean; reason?: string }> {
    this.ran++;
    // Observe what the base persisted before calling us (proves attempted-before-side-effect).
    try {
      const st = JSON.parse((this as any).fs.readFileSync('/a/command-state.json', 'utf8'));
      this.seenAttemptedAt = st.acks?.[cmd.id]?.result === 'attempted' ? 1 : 0;
    } catch { this.seenAttemptedAt = 0; }
    if (this.behavior === 'throw') throw new Error('boom');
    if (this.behavior === 'fail') return { applied: false, reason: 'declined' };
    return { applied: true };
  }
}

function action(over: Partial<CommandSigningFields> = {}, seedHex = owner.seedHex): Command {
  const f: CommandSigningFields = {
    agentId: 'a', seq: 1, id: 'act1', type: 'action',
    payload: { action: 'ping' }, createdAt: 1_000, expiresAt: 10_000, ...over,
  };
  return { ...f, ownerSig: signCommand(seedHex, f) };
}

function mkBot(commands: Command[]) {
  const fs = new MemFs();
  fs.files.set('/a/config.json', JSON.stringify({ topN: 3 }));
  fs.files.set('/a/commands.json', JSON.stringify({ ownerPubkeyHex: owner.pubkey, commands }));
  const bot = new ActionBot({
    context: { dataDir: '/a', name: 'a' }, custody: new MockCustody({ now: () => 0 }),
    fs, now: () => NOW, onExit: () => {}, print: () => {},
  });
  return { bot, fs };
}

test('allow-listed action runs once, acked applied, fence advanced', async () => {
  const { bot, fs } = mkBot([action()]);
  await bot.start();
  await bot.runTick();
  assert.equal(bot.ran, 1);
  const acks = JSON.parse(fs.files.get('/a/command-acks.json')!).acks;
  assert.equal(acks[0].result, 'applied');
  assert.equal(JSON.parse(fs.files.get('/a/heartbeat.json')!).lastCmdSeq, 1);
});

test('the attempted ack is persisted BEFORE the side effect (at-most-once commit point)', async () => {
  const { bot } = mkBot([action()]);
  await bot.start();
  await bot.runTick();
  assert.equal(bot.seenAttemptedAt, 1, 'onCommand saw its own command already marked attempted');
});

test('once-only: the same action id delivered twice runs only once', async () => {
  const { bot } = mkBot([action()]);
  await bot.start();
  await bot.runTick();
  await bot.runTick(); // node-host re-delivers before the ack propagates
  assert.equal(bot.ran, 1, 'not re-run');
});

test('crash-safety: a fresh instance re-loading state does not re-run an attempted action', async () => {
  const { bot, fs } = mkBot([action()]);
  await bot.start();
  await bot.runTick();
  assert.equal(bot.ran, 1);
  // Simulate a restart: a NEW instance over the SAME dataDir (state persisted), same command still delivered.
  const bot2 = new ActionBot({
    context: { dataDir: '/a', name: 'a' }, custody: new MockCustody({ now: () => 0 }),
    fs, now: () => NOW, onExit: () => {}, print: () => {},
  });
  await bot2.start();
  await bot2.runTick();
  assert.equal(bot2.ran, 0, 'restart does not re-execute the already-attempted action');
});

test('a throwing action is caught, recorded failed, and never retried (drain never throws)', async () => {
  const { bot, fs } = mkBot([action()]);
  bot.behavior = 'throw';
  await bot.start();
  await bot.runTick(); // must not throw
  const acks = JSON.parse(fs.files.get('/a/command-acks.json')!).acks;
  assert.equal(acks[0].result, 'failed');
  assert.match(acks[0].reason, /^action-threw:/);
  await bot.runTick();
  assert.equal(bot.ran, 1, 'a crashed action is not retried (at-most-once)');
});

test('action not in the allowlist is rejected without running', async () => {
  const { bot, fs } = mkBot([action({ payload: { action: 'selfDestruct' } })]);
  await bot.start();
  await bot.runTick();
  assert.equal(bot.ran, 0);
  const acks = JSON.parse(fs.files.get('/a/command-acks.json')!).acks;
  assert.match(acks[0].reason, /^action-not-allowed:selfDestruct$/);
});

test('a forged action is rejected (bad-signature), never runs', async () => {
  const { bot, fs } = mkBot([action({}, attacker.seedHex)]);
  await bot.start();
  await bot.runTick();
  assert.equal(bot.ran, 0);
  assert.equal(JSON.parse(fs.files.get('/a/command-acks.json')!).acks[0].reason, 'bad-signature');
});

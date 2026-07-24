// Command Inbox T3 — the agent's drain loop (docs/COMMAND_INBOX.md §9). Drives a real
// signed command through the file interface a node-host would write, and checks the agent
// applies a valid config-patch, advances the fence, stages an ack, exposes counts in the
// heartbeat, ignores a replay, and rejects forged / out-of-scope commands with a reason.
import { test } from 'node:test';
import assert from 'node:assert';
import { CircuitAgent, type FsLike } from '../src/agent.ts';
import { MockCustody } from '../src/custody.ts';
import { generateAttestSigner } from '@circuit-llm/attest';
import { signCommand, type Command, type CommandSigningFields } from '../src/commands.ts';

class MemFs implements FsLike {
  files = new Map<string, string>();
  readFileSync(p: string, _enc: 'utf8'): string {
    const v = this.files.get(p);
    if (v == null) throw new Error('ENOENT');
    return v;
  }
  writeFileSync(p: string, d: string): void { this.files.set(p, d); }
  appendFileSync(p: string, d: string): void { this.files.set(p, (this.files.get(p) ?? '') + d); }
  mkdirSync(): void {}
}

class NoopBot extends CircuitAgent {
  async tick(): Promise<void> {}
}

const owner = generateAttestSigner();
const attacker = generateAttestSigner();
const NOW = 5_000;

function cmd(over: Partial<CommandSigningFields>, seedHex = owner.seedHex): Command {
  const fields: CommandSigningFields = {
    agentId: 'agent-1', seq: 1, id: 'c1', type: 'config-patch',
    payload: { topN: 9 }, createdAt: 1_000, expiresAt: 10_000, ...over,
  };
  return { ...fields, ownerSig: signCommand(seedHex, fields) };
}

function makeBot(commands: Command[], ownerPubkeyHex: string | null = owner.pubkey) {
  const fs = new MemFs();
  fs.files.set('/data/config.json', JSON.stringify({ scanIntervalMs: 1000, topN: 3 }));
  fs.files.set('/data/commands.json', JSON.stringify({ ownerPubkeyHex, commands }));
  const bot = new NoopBot({
    context: { dataDir: '/data', name: 'bot' },
    custody: new MockCustody({ now: () => 0 }),
    fs, now: () => NOW, onExit: () => {}, print: () => {},
  });
  return { bot, fs };
}

test('applies a valid config-patch: merges config, persists it, stages an applied ack, advances the fence', async () => {
  const { bot, fs } = makeBot([cmd({})]);
  await bot.start();
  await bot.runTick();
  assert.equal(JSON.parse(fs.files.get('/data/config.json')!).topN, 9, 'config knob updated');
  const acks = JSON.parse(fs.files.get('/data/command-acks.json')!).acks;
  assert.equal(acks.length, 1);
  assert.equal(acks[0].id, 'c1');
  assert.equal(acks[0].seq, 1);
  assert.equal(acks[0].result, 'applied');
  const hb = JSON.parse(fs.files.get('/data/heartbeat.json')!);
  assert.equal(hb.commandsApplied, 1);
  assert.equal(hb.lastCmdSeq, 1);
});

test('idempotent: a replayed (already-acked) command is not applied twice', async () => {
  const { bot, fs } = makeBot([cmd({})]);
  await bot.start();
  await bot.runTick();
  // node-host re-delivers the same command before the ack propagates
  fs.files.set('/data/config.json', JSON.stringify({ scanIntervalMs: 1000, topN: 3 })); // pretend a manual reset
  await bot.runTick();
  assert.equal(JSON.parse(fs.files.get('/data/config.json')!).topN, 3, 'not re-applied (already acked)');
  assert.equal(JSON.parse(fs.files.get('/data/heartbeat.json')!).commandsApplied, 1);
});

test('rejects a forged command with reason=bad-signature (fence does not advance)', async () => {
  const { bot, fs } = makeBot([cmd({}, attacker.seedHex)]);
  await bot.start();
  await bot.runTick();
  assert.equal(JSON.parse(fs.files.get('/data/config.json')!).topN, 3, 'not applied');
  const acks = JSON.parse(fs.files.get('/data/command-acks.json')!).acks;
  assert.equal(acks[0].result, 'rejected');
  assert.equal(acks[0].reason, 'bad-signature');
  assert.equal(JSON.parse(fs.files.get('/data/heartbeat.json')!).lastCmdSeq, 0);
});

test('rejects an out-of-schema patch with reason (scope allowlist)', async () => {
  const { bot, fs } = makeBot([cmd({ id: 'c2', payload: { maxDailySol: 999 } })]);
  await bot.start();
  await bot.runTick();
  const acks = JSON.parse(fs.files.get('/data/command-acks.json')!).acks;
  assert.equal(acks[0].result, 'rejected');
  assert.match(acks[0].reason, /^out-of-schema:maxDailySol$/);
});

test('no owner pubkey provisioned → commands ignored (no acks, no apply)', async () => {
  const { bot, fs } = makeBot([cmd({})], null);
  await bot.start();
  await bot.runTick();
  assert.equal(JSON.parse(fs.files.get('/data/config.json')!).topN, 3);
  assert.equal(fs.files.has('/data/command-acks.json'), false);
});

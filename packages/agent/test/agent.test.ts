import { test } from 'node:test';
import assert from 'node:assert';
import { CircuitAgent, type FsLike } from '../src/agent.ts';
import { MockCustody } from '../src/custody.ts';

class MemFs implements FsLike {
  files = new Map<string, string>();
  readFileSync(p: string, _enc: 'utf8'): string {
    const v = this.files.get(p);
    if (v == null) throw new Error('ENOENT');
    return v;
  }
  writeFileSync(p: string, d: string): void {
    this.files.set(p, d);
  }
  appendFileSync(p: string, d: string): void {
    this.files.set(p, (this.files.get(p) ?? '') + d);
  }
  mkdirSync(): void {}
}

class TestBot extends CircuitAgent {
  bought = 0;
  async setup(): Promise<void> {
    this.log('setup');
  }
  async tick(): Promise<void> {
    const r = await this.buy('MINT', 0.01);
    if (r.ok) {
      this.bought++;
      this.positions.push({ symbol: 'MINT', sizeSol: 0.01 });
    }
  }
}

function makeBot() {
  const fs = new MemFs();
  fs.files.set('/data/config.json', JSON.stringify({ scanIntervalMs: 1234, strategy: 'x' }));
  const exits: number[] = [];
  const bot = new TestBot({
    context: { dataDir: '/data', name: 'bot' },
    custody: new MockCustody({ now: () => 0 }),
    fs,
    now: () => 1000,
    onExit: (c) => exits.push(c),
    print: () => {},
  });
  return { bot, fs, exits };
}

test('start() reads config, calls setup, writes a running heartbeat + boot log', async () => {
  const { bot, fs } = makeBot();
  await bot.start();
  const hb = JSON.parse(fs.files.get('/data/heartbeat.json')!);
  assert.equal(hb.state, 'running');
  assert.equal(hb.name, 'bot');
  assert.equal(hb.custody, 'local');
  assert.equal(hb.paper, true);
  const log = fs.files.get('/data/agent.log')!;
  assert.ok(log.includes('agent up'));
  assert.ok(log.includes('setup'));
});

test('runTick increments scans, runs the strategy, signs via custody', async () => {
  const { bot, fs } = makeBot();
  await bot.start();
  await bot.runTick();
  assert.equal(bot.bought, 1);
  const hb = JSON.parse(fs.files.get('/data/heartbeat.json')!);
  assert.equal(hb.scans, 1);
  assert.equal(hb.signedTrades, 1);
  assert.equal(hb.positions.length, 1);
});

test('stop() drains, writes a stopped heartbeat, and exits 0', async () => {
  const { bot, fs, exits } = makeBot();
  await bot.start();
  await bot.stop('SIGTERM');
  const hb = JSON.parse(fs.files.get('/data/heartbeat.json')!);
  assert.equal(hb.state, 'stopped');
  assert.deepEqual(exits, [0]);
});

test('a throwing tick is caught + logged, never thrown', async () => {
  class Boom extends CircuitAgent {
    async tick(): Promise<void> {
      throw new Error('kaboom');
    }
  }
  const fs = new MemFs();
  const bot = new Boom({
    context: { dataDir: '/d' },
    custody: new MockCustody(),
    fs,
    now: () => 0,
    print: () => {},
    onExit: () => {},
  });
  await bot.start();
  await bot.runTick(); // must not throw
  assert.ok(fs.files.get('/d/agent.log')!.includes('kaboom'));
});

test('context resolves from env when not overridden', async () => {
  class Noop extends CircuitAgent {
    async tick(): Promise<void> {}
  }
  const fs = new MemFs();
  const bot = new Noop({
    env: {
      CIRCUIT_AGENT_DATA_DIR: '/e',
      AGENT_NAME: 'envbot',
      CIRCUIT_SIGNER_URL: 'http://signer',
      CIRCUIT_AGENT_ID: 'a9',
      CIRCUIT_AGENT_EPOCH: '3',
      CIRCUIT_AGENT_SESSION: 'tok',
      CIRCUIT_AGENT_ADDRESS: 'WALLET',
    } as NodeJS.ProcessEnv,
    fs,
    print: () => {},
    onExit: () => {},
  });
  assert.equal(bot.ctx.name, 'envbot');
  assert.equal(bot.ctx.agentId, 'a9');
  assert.equal(bot.ctx.epoch, 3);
  assert.equal(bot.custody.kind, 'offbox-signer'); // signerUrl present → real custody
});

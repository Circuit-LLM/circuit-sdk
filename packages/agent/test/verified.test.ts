import { test } from 'node:test';
import assert from 'node:assert';
import { CircuitAgent, type FsLike } from '../src/agent.ts';
import { generateAttestSigner, signQuote, type Rule, type VerifiedIntent } from '@circuit-llm/attest';

class MemFs implements FsLike {
  files = new Map<string, string>();
  readFileSync(p: string): string {
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

const dataSigner = generateAttestSigner();
const RULE: Rule = {
  id: 'dip-v1',
  when: [{ input: 'price', op: '<', value: 2 }],
  then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
  requires: ['price'],
};

class Bot extends CircuitAgent {
  async tick(): Promise<void> {}
}

function makeBot(): Bot {
  return new Bot({
    context: { dataDir: '/d' },
    rule: RULE,
    acceptedKeys: { [dataSigner.pubkey]: 'data' },
    fs: new MemFs(),
    print: () => {},
    onExit: () => {},
  });
}

function freshQuote(price: number, nonce: string) {
  return signQuote(dataSigner, { path: '/api/token-price?mint=MINT', data: { price, mint: 'MINT' }, ts: Date.now(), nonce });
}

test('verified mode auto-selects MockCustody with the gate, and a genuine trade is accepted', async () => {
  const bot = makeBot();
  assert.equal(bot.custody.kind, 'local');
  const r = await bot.verifiedTrade({ price: 1.8, mint: 'MINT' }, [freshQuote(1.8, 'a')]);
  assert.ok(r);
  assert.equal(r.ok, true);
});

test('no signal (rule does not fire) → returns null, no trade', async () => {
  const bot = makeBot();
  const r = await bot.verifiedTrade({ price: 2.5, mint: 'MINT' }, [freshQuote(2.5, 'b')]);
  assert.equal(r, null);
});

test('a malicious host crafting a forged verified intent is rejected by the gate', async () => {
  const bot = makeBot();
  // bypass verifiedTrade entirely — submit a self-chosen trade with genuine evidence
  const forged: VerifiedIntent = {
    intent: { kind: 'buy', token: 'EVIL', sizeSol: 0.01 }, // rule produces MINT, not EVIL
    rule: 'dip-v1',
    inputs: { price: 1.8, mint: 'MINT' },
    evidence: [freshQuote(1.8, 'c')],
  };
  const r = await bot.custody.verifiedIntent!(forged);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'decision-unjustified');
});

test('verifiedTrade without a committed rule throws', async () => {
  const bot = new Bot({ context: { dataDir: '/d' }, fs: new MemFs(), print: () => {}, onExit: () => {} });
  await assert.rejects(() => bot.verifiedTrade({ price: 1 }, []), /requires a committed rule/);
});

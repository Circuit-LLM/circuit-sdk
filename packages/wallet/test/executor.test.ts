import { test } from 'node:test';
import assert from 'node:assert';
import { walletTradeExecutor } from '../src/executor.ts';
import type { Wallet } from '../src/wallet.ts';
import { SOL_MINT } from '@circuit/core';

function mockWallet() {
  const calls: { inMint: string; outMint: string; amount: bigint | number; slip?: number }[] = [];
  const wallet = {
    async swap(inMint: string, outMint: string, amount: bigint | number, slip?: number) {
      calls.push({ inMint, outMint, amount, slip });
      return { sig: 'SIG', quote: {} };
    },
  } as unknown as Wallet;
  return { wallet, calls };
}

test('walletTradeExecutor buy = swap SOL→token for sizeSol lamports, returns sig + solValue', async () => {
  const { wallet, calls } = mockWallet();
  const r = await walletTradeExecutor(wallet).execute({ kind: 'buy', token: 'MINT', sizeSol: 0.01, maxSlippageBps: 150 });
  assert.equal(r.signature, 'SIG');
  assert.equal(r.solValue, 0.01);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.inMint, SOL_MINT);
  assert.equal(calls[0]!.outMint, 'MINT');
  assert.equal(calls[0]!.amount, 10_000_000n); // 0.01 SOL → lamports
  assert.equal(calls[0]!.slip, 150);
});

test('walletTradeExecutor sell = swap token→SOL for amount (token base units)', async () => {
  const { wallet, calls } = mockWallet();
  const r = await walletTradeExecutor(wallet).execute({ kind: 'sell', token: 'MINT', amount: 5000 });
  assert.equal(r.signature, 'SIG');
  assert.equal(r.solValue, undefined);
  assert.equal(calls[0]!.inMint, 'MINT');
  assert.equal(calls[0]!.outMint, SOL_MINT);
  assert.equal(calls[0]!.amount, 5000);
});

test('walletTradeExecutor rejects malformed intents (never sends a blind swap)', async () => {
  const { wallet } = mockWallet();
  const ex = walletTradeExecutor(wallet);
  await assert.rejects(() => ex.execute({ kind: 'buy', token: 'MINT' }), /positive sizeSol/);
  await assert.rejects(() => ex.execute({ kind: 'sell', token: 'MINT' }), /positive amount/);
  await assert.rejects(() => ex.execute({ kind: 'buy', sizeSol: 0.01 }), /token mint/);
});

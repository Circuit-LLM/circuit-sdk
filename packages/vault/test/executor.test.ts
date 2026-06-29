import { test } from 'node:test';
import assert from 'node:assert';
import * as anchor from '@anchor-lang/core';
import { makeVaultExecutor, VaultClient, TOKEN_PROGRAM_ID, type RouteSource, type TradeParams } from '../src/index.ts';

const { PublicKey, Keypair, TransactionInstruction, Ed25519Program } = anchor.web3;
const WSOL = new PublicKey('So11111111111111111111111111111111111111112');
const TOKEN = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC mint, used as a stand-in

function dummyIx(): anchor.web3.TransactionInstruction {
  return new TransactionInstruction({ programId: TOKEN, keys: [], data: Buffer.alloc(0) });
}

/** A RouteSource that records its calls and returns fixed amounts (no network). */
function mockRoute(inAmount: bigint, minOut: bigint) {
  const calls: Array<{ inputMint: string; outputMint: string; amount: bigint; slippageBps: number }> = [];
  const route: RouteSource = {
    async quote(p) {
      calls.push({ inputMint: p.inputMint.toBase58(), outputMint: p.outputMint.toBase58(), amount: p.amount, slippageBps: p.slippageBps });
      return { swapIx: dummyIx(), inAmount, minOut };
    },
  };
  return { route, calls };
}

/** A VaultClient stand-in that records trade() params (no validator). */
function mockClient() {
  const trades: TradeParams[] = [];
  const client = {
    vaultPda: () => PublicKey.findProgramAddressSync([Buffer.from('vault')], TOKEN)[0],
    trade: async (p: TradeParams) => {
      trades.push(p);
      return `SIG_${trades.length}`;
    },
  } as unknown as VaultClient;
  return { client, trades };
}

const baseOpts = (route: RouteSource, client: VaultClient) => ({
  client,
  owner: Keypair.generate().publicKey,
  agentSeed: Buffer.alloc(32, 1),
  delegate: Keypair.generate(),
  ataFor: (m: anchor.web3.PublicKey) => ({ account: m }), // mint stands in as its own ATA for assertions
  route,
  wsolMint: WSOL,
});

test('BUY maps sizeSol → wSOL-in, token-out, and reports the wSOL leg as solValue', async () => {
  const { route, calls } = mockRoute(500_000_000n, 123n);
  const { client, trades } = mockClient();
  const exec = makeVaultExecutor(baseOpts(route, client));

  const r = await exec.execute({ kind: 'buy', token: TOKEN.toBase58(), sizeSol: 0.5 });

  assert.equal(r.signature, 'SIG_1');
  assert.equal(r.solValue, 0.5);
  assert.equal(calls[0]!.inputMint, WSOL.toBase58());
  assert.equal(calls[0]!.outputMint, TOKEN.toBase58());
  assert.equal(calls[0]!.amount, 500_000_000n); // 0.5 SOL in lamports
  assert.equal(trades[0]!.amountIn, 500_000_000n);
  assert.equal(trades[0]!.minOut, 123n);
  assert.equal((trades[0]!.vaultInput as anchor.web3.PublicKey).toBase58(), WSOL.toBase58());
  assert.equal((trades[0]!.vaultOutput as anchor.web3.PublicKey).toBase58(), TOKEN.toBase58());
  assert.equal((trades[0]!.tokenProgram as anchor.web3.PublicKey).toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(trades[0]!.oracleIx, undefined);
});

test('SELL maps token-in, wSOL-out, amount in base units, solValue = minOut wSOL', async () => {
  const { route, calls } = mockRoute(1000n, 900_000_000n);
  const { client, trades } = mockClient();
  const exec = makeVaultExecutor(baseOpts(route, client));

  const r = await exec.execute({ kind: 'sell', token: TOKEN.toBase58(), amount: 1000 });

  assert.equal(r.solValue, 0.9);
  assert.equal(calls[0]!.inputMint, TOKEN.toBase58());
  assert.equal(calls[0]!.outputMint, WSOL.toBase58());
  assert.equal(calls[0]!.amount, 1000n);
  assert.equal(trades[0]!.amountIn, 1000n);
  assert.equal(trades[0]!.minOut, 900_000_000n);
});

test('a verified intent is attested and carried as the trade oracleIx', async () => {
  const { route } = mockRoute(100n, 50n);
  const { client, trades } = mockClient();
  let attestCalls = 0;
  const exec = makeVaultExecutor({
    ...baseOpts(route, client),
    attest: () => {
      attestCalls++;
      return dummyIx();
    },
  });

  await exec.execute({ kind: 'buy', token: TOKEN.toBase58(), sizeSol: 0.1 }, { rule: 'price>=x' });
  assert.equal(attestCalls, 1);
  assert.ok(trades[0]!.oracleIx, 'oracleIx should be attached for a verified intent');
});

test('rejects bad intents', async () => {
  const { route } = mockRoute(1n, 1n);
  const { client } = mockClient();
  const exec = makeVaultExecutor(baseOpts(route, client));

  await assert.rejects(() => exec.execute({ kind: 'hodl' as unknown as 'buy', token: TOKEN.toBase58() }), /unsupported intent kind/);
  await assert.rejects(() => exec.execute({ kind: 'buy', sizeSol: 0.5 }), /token \(mint\) is required/);
  await assert.rejects(() => exec.execute({ kind: 'buy', token: TOKEN.toBase58(), sizeSol: 0 }), /amount must be > 0/);

  // a verified intent with no attest builder configured
  const execNoAttest = makeVaultExecutor(baseOpts(route, client));
  await assert.rejects(
    () => execNoAttest.execute({ kind: 'buy', token: TOKEN.toBase58(), sizeSol: 0.5 }, { rule: 'x' }),
    /requires an `attest` builder/,
  );
});

test('oracleAttestation builds an Ed25519 instruction over feed|price|ts', () => {
  const oracle = Keypair.generate();
  const ix = VaultClient.oracleAttestation(oracle, Buffer.alloc(32, 9), 12345, 1717000000);
  assert.equal(ix.programId.toBase58(), Ed25519Program.programId.toBase58());
  // the ed25519 instruction embeds its header + the signed 48-byte (feed|price|ts) message
  assert.ok(ix.data.length > 48);
});

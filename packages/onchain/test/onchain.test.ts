import { test } from 'node:test';
import assert from 'node:assert';
import { getStakePositions, verifyStake, STAKEPOINT_PROGRAM_ID } from '../src/stakepoint.ts';
import { circBalance } from '../src/balance.ts';
import { RpcError } from '../src/rpc.ts';

const DISCRIMINATOR = '96c5b01d37847095';

/** Build a 185-byte StakerPosition account, base64-encoded. */
function stakerAccount(stakedRaw: bigint, lockUntil = 0): string {
  const buf = Buffer.alloc(185);
  Buffer.from(DISCRIMINATOR, 'hex').copy(buf, 0);
  buf.writeBigUInt64LE(stakedRaw, 72);
  buf.writeBigUInt64LE(BigInt(lockUntil), 80);
  return buf.toString('base64');
}

function rpcStub(result: unknown, capture?: (body: any) => void): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    capture?.(JSON.parse(init.body as string));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }) as unknown as typeof fetch;
}

test('getStakePositions parses + filters zero-staked, sends the right filters', async () => {
  let req: any;
  const fetchImpl = rpcStub(
    [
      { pubkey: 'POS1', account: { data: [stakerAccount(123_000_000n), 'base64'] } },
      { pubkey: 'POS0', account: { data: [stakerAccount(0n), 'base64'] } }, // filtered
    ],
    (b) => (req = b),
  );
  const pos = await getStakePositions('WALLET', 'POOL', { rpcUrl: 'http://rpc', fetchImpl });
  assert.equal(pos.length, 1);
  assert.equal(pos[0]!.stakedRaw, 123_000_000n);
  assert.equal(req.method, 'getProgramAccounts');
  assert.equal(req.params[0], STAKEPOINT_PROGRAM_ID);
  assert.equal(req.params[1].filters[1].memcmp.bytes, 'WALLET');
  assert.equal(req.params[1].filters[2].memcmp.bytes, 'POOL');
});

test('verifyStake sums positions and checks eligibility exactly', async () => {
  const fetchImpl = rpcStub([
    { pubkey: 'A', account: { data: [stakerAccount(60_000_000n), 'base64'] } }, // 60 CIRC
    { pubkey: 'B', account: { data: [stakerAccount(50_000_000n), 'base64'] } }, // 50 CIRC
  ]);
  const r = await verifyStake('W', 'P', 100, { rpcUrl: 'http://rpc', fetchImpl }); // need 100 CIRC
  assert.equal(r.eligible, true); // 110 >= 100
  assert.equal(r.stakedAmount, 110);
  assert.equal(r.stakedRaw, '110000000');
  assert.equal(r.positionCount, 2);

  const r2 = await verifyStake('W', 'P', 200, { rpcUrl: 'http://rpc', fetchImpl });
  assert.equal(r2.eligible, false); // 110 < 200
});

test('verifyStake reports active locks', async () => {
  const future = 9_000_000_000;
  const fetchImpl = rpcStub([{ pubkey: 'A', account: { data: [stakerAccount(10_000_000n, future), 'base64'] } }]);
  const r = await verifyStake('W', 'P', 1, { rpcUrl: 'http://rpc', fetchImpl, now: () => 1_000_000_000_000 });
  assert.equal(r.lockActive, true);
  assert.equal(r.lockUntil, future);
});

test('verifyStake handles no positions', async () => {
  const r = await verifyStake('W', 'P', 1, { rpcUrl: 'http://rpc', fetchImpl: rpcStub([]) });
  assert.equal(r.eligible, false);
  assert.equal(r.positionCount, 0);
});

test('circBalance sums token accounts', async () => {
  const fetchImpl = rpcStub({
    value: [
      { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 12.5, amount: '12500000' } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { uiAmount: 2.5, amount: '2500000' } } } } } },
    ],
  });
  assert.equal(await circBalance('W', { rpcUrl: 'http://rpc', fetchImpl }), 15);
});

test('rpcCall surfaces RPC errors', async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ error: { code: -32602, message: 'bad' } }), { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(() => circBalance('W', { rpcUrl: 'http://rpc', fetchImpl }), RpcError);
});

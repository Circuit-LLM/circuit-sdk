import { test } from 'node:test';
import assert from 'node:assert';
import {
  decodeNode,
  decodeMeshConfig,
  getNode,
  getNodes,
  getMeshConfig,
  MESH_REGISTRY_PROGRAM_ID,
  type SlotRange,
} from '../src/mesh-registry.ts';
import { base58 } from '../src/bs58.ts';
import type { RpcOptions } from '../src/rpc.ts';

const NODE_DISC = 'd0350103317ab431';
const CONFIG_DISC = 'eff3dba40bea7cf5';

function nodeAccount(o: {
  node: Buffer;
  role?: number;
  trust?: number;
  banned?: boolean;
  payout: Buffer;
  stakePool: Buffer;
  joinedAt?: bigint;
  updatedAt?: bigint;
  bump?: number;
  disc?: string;
}): Buffer {
  const buf = Buffer.alloc(124);
  Buffer.from(o.disc ?? NODE_DISC, 'hex').copy(buf, 0);
  o.node.copy(buf, 8);
  buf.writeUInt8(o.role ?? 0, 40);
  buf.writeUInt8(o.trust ?? 0, 41);
  buf.writeUInt8(o.banned ? 1 : 0, 42);
  o.payout.copy(buf, 43);
  o.stakePool.copy(buf, 75);
  buf.writeBigInt64LE(o.joinedAt ?? 0n, 107);
  buf.writeBigInt64LE(o.updatedAt ?? 0n, 115);
  buf.writeUInt8(o.bump ?? 255, 123);
  return buf;
}

function meshConfigAccount(o: {
  authority: Buffer;
  auditor: Buffer;
  modelFp?: string;
  numLayers?: number;
  replication?: number;
  slots?: SlotRange[];
  version?: number;
  bump?: number;
}): Buffer {
  const fp = Buffer.from(o.modelFp ?? 'qwen2.5-72b-awq', 'utf8');
  const slots = o.slots ?? [
    { start: 0, end: 40 },
    { start: 40, end: 80 },
  ];
  const buf = Buffer.alloc(8 + 32 + 32 + 4 + fp.length + 2 + 1 + 4 + slots.length * 4 + 4 + 1);
  let p = 0;
  Buffer.from(CONFIG_DISC, 'hex').copy(buf, p);
  p += 8;
  o.authority.copy(buf, p);
  p += 32;
  o.auditor.copy(buf, p);
  p += 32;
  buf.writeUInt32LE(fp.length, p);
  p += 4;
  fp.copy(buf, p);
  p += fp.length;
  buf.writeUInt16LE(o.numLayers ?? 80, p);
  p += 2;
  buf.writeUInt8(o.replication ?? 2, p);
  p += 1;
  buf.writeUInt32LE(slots.length, p);
  p += 4;
  for (const s of slots) {
    buf.writeUInt16LE(s.start, p);
    buf.writeUInt16LE(s.end, p + 2);
    p += 4;
  }
  buf.writeUInt32LE(o.version ?? 1, p);
  p += 4;
  buf.writeUInt8(o.bump ?? 254, p);
  return buf;
}

/** RpcOptions whose fetchImpl returns a fixed getProgramAccounts result. */
function mockRpc(accounts: Array<{ pubkey: string; data: Buffer }>): RpcOptions {
  const result = accounts.map((a) => ({ pubkey: a.pubkey, account: { data: [a.data.toString('base64'), 'base64'] } }));
  return {
    rpcUrl: 'http://mock',
    fetchImpl: (async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) })) as unknown as typeof fetch,
  };
}

test('decodeNode reads every field at the right offset', () => {
  const node = Buffer.alloc(32, 1);
  const payout = Buffer.alloc(32, 2);
  const stakePool = Buffer.alloc(32, 3);
  const decoded = decodeNode(
    'NodePDA1111111111111111111111111111111111111',
    nodeAccount({ node, role: 1, trust: 1, banned: true, payout, stakePool, joinedAt: 1717000000n, updatedAt: 1717000123n }),
  );
  assert.equal(decoded.node, base58(node));
  assert.equal(decoded.role, 'holder');
  assert.equal(decoded.trust, 'trusted');
  assert.equal(decoded.banned, true);
  assert.equal(decoded.payoutWallet, base58(payout));
  assert.equal(decoded.stakePool, base58(stakePool));
  assert.equal(decoded.joinedAt, 1717000000);
  assert.equal(decoded.updatedAt, 1717000123);
});

test('decodeNode maps enum 0 → orchestrator/probation and rejects a bad discriminator', () => {
  const decoded = decodeNode('x', nodeAccount({ node: Buffer.alloc(32, 5), payout: Buffer.alloc(32), stakePool: Buffer.alloc(32) }));
  assert.equal(decoded.role, 'orchestrator');
  assert.equal(decoded.trust, 'probation');
  assert.equal(decoded.banned, false);

  const bad = nodeAccount({ node: Buffer.alloc(32), payout: Buffer.alloc(32), stakePool: Buffer.alloc(32), disc: 'ffffffffffffffff' });
  assert.throws(() => decodeNode('x', bad), /bad discriminator/);
});

test('decodeMeshConfig reads variable-length model_fp + slots', () => {
  const authority = Buffer.alloc(32, 9);
  const auditor = Buffer.alloc(32, 8);
  const cfg = decodeMeshConfig(
    'MeshCfg',
    meshConfigAccount({ authority, auditor, modelFp: 'qwen2.5-72b-awq', numLayers: 80, replication: 2, version: 3 }),
  );
  assert.equal(cfg.authority, base58(authority));
  assert.equal(cfg.auditor, base58(auditor));
  assert.equal(cfg.modelFp, 'qwen2.5-72b-awq');
  assert.equal(cfg.numLayers, 80);
  assert.equal(cfg.replication, 2);
  assert.equal(cfg.version, 3);
  assert.deepEqual(cfg.slots, [
    { start: 0, end: 40 },
    { start: 40, end: 80 },
  ]);
});

test('getNodes / getNode decode over a mocked RPC', async () => {
  const acct = nodeAccount({ node: Buffer.alloc(32, 7), payout: Buffer.alloc(32, 2), stakePool: Buffer.alloc(32, 3), role: 1 });
  const nodes = await getNodes(mockRpc([{ pubkey: 'PDA-A', data: acct }]));
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!.role, 'holder');
  assert.equal(nodes[0]!.node, base58(Buffer.alloc(32, 7)));

  const one = await getNode('PDA-A', mockRpc([{ pubkey: 'PDA-A', data: acct }]));
  assert.equal(one?.node, base58(Buffer.alloc(32, 7)));

  const none = await getNode('PDA-A', mockRpc([]));
  assert.equal(none, null);
});

test('getMeshConfig returns the singleton or null', async () => {
  const acct = meshConfigAccount({ authority: Buffer.alloc(32, 9), auditor: Buffer.alloc(32, 8), version: 5 });
  const cfg = await getMeshConfig(mockRpc([{ pubkey: 'CFG', data: acct }]));
  assert.equal(cfg?.version, 5);
  assert.equal(cfg?.address, 'CFG');

  const empty = await getMeshConfig(mockRpc([]));
  assert.equal(empty, null);
});

test('program id is the deployed devnet mesh_registry', () => {
  assert.equal(MESH_REGISTRY_PROGRAM_ID, 'BC2sxffu498cB8gUp3P5V5HuBLDsx9XCtJdEmnnGUvfe');
});

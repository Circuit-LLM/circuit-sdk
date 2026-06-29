// mesh_registry reads — the on-chain Circuit DLLM control plane (slow, authoritative state: topology +
// per-node membership/trust/ban). Pure JSON-RPC (getProgramAccounts + memcmp + manual Borsh decode), the
// same dependency-free pattern as stakepoint.ts. We only READ; trust/ban edits are auditor-signed writes
// that live in the CLI/operator tooling. Program + account layout: circuit-dllm/onchain mesh_registry.

import { rpcCall, type RpcOptions } from './rpc.ts';
import { base58 } from './bs58.ts';

export const MESH_REGISTRY_PROGRAM_ID = 'BC2sxffu498cB8gUp3P5V5HuBLDsx9XCtJdEmnnGUvfe';

// Anchor account discriminators = first 8 bytes of sha256("account:<Name>"). Hex for the decode-time
// check; base58 for the getProgramAccounts memcmp filter (the RPC `bytes` field is base58).
const NODE_DISCRIMINATOR = 'd0350103317ab431';
const NODE_DISCRIMINATOR_B58 = 'bpsQsGpQe1N';
const MESH_CONFIG_DISCRIMINATOR = 'eff3dba40bea7cf5';
const MESH_CONFIG_DISCRIMINATOR_B58 = 'h8qkU9oSVXr';

// Node = disc(8) + node(32) + role(1) + trust(1) + banned(1) + payout(32) + stakePool(32)
//        + joinedAt(i64) + updatedAt(i64) + bump(1) = 124 bytes (fixed).
const NODE_ACCOUNT_SIZE = 124;

export type NodeRole = 'orchestrator' | 'holder';
export type TrustLevel = 'probation' | 'trusted';

const ROLES: readonly NodeRole[] = ['orchestrator', 'holder'];
const TRUST: readonly TrustLevel[] = ['probation', 'trusted'];

export interface MeshNode {
  address: string; // the Node PDA account address
  node: string; // the node's ed25519 identity (== the key that registered it)
  role: NodeRole;
  trust: TrustLevel;
  banned: boolean;
  payoutWallet: string;
  stakePool: string;
  joinedAt: number; // unix seconds
  updatedAt: number; // unix seconds
}

export interface SlotRange {
  start: number;
  end: number;
}

export interface MeshConfig {
  address: string;
  authority: string; // governance: edits topology, sets auditor
  auditor: string; // the only key that may flip node trust/ban
  modelFp: string; // e.g. "qwen2.5-72b-awq"
  numLayers: number;
  replication: number;
  slots: SlotRange[]; // a validated partition of [0, numLayers)
  version: number; // monotonic; readers diff on this to detect a layout change
  bump: number;
}

interface ProgramAccount {
  pubkey: string;
  account: { data: [string, string] };
}

/** Decode a 124-byte Node account (pure). Throws if the discriminator/size is wrong. */
export function decodeNode(address: string, data: Buffer): MeshNode {
  if (data.length < NODE_ACCOUNT_SIZE) throw new Error(`Node account too small: ${data.length} < ${NODE_ACCOUNT_SIZE}`);
  if (data.subarray(0, 8).toString('hex') !== NODE_DISCRIMINATOR) throw new Error('not a Node account (bad discriminator)');
  const roleByte = data.readUInt8(40);
  const trustByte = data.readUInt8(41);
  const role = ROLES[roleByte];
  const trust = TRUST[trustByte];
  if (!role) throw new Error(`unknown node role ${roleByte}`);
  if (!trust) throw new Error(`unknown trust level ${trustByte}`);
  return {
    address,
    node: base58(data.subarray(8, 40)),
    role,
    trust,
    banned: data.readUInt8(42) !== 0, // canonical Borsh bool: any non-zero byte is true
    payoutWallet: base58(data.subarray(43, 75)),
    stakePool: base58(data.subarray(75, 107)),
    joinedAt: Number(data.readBigInt64LE(107)),
    updatedAt: Number(data.readBigInt64LE(115)),
  };
}

/** Decode the singleton MeshConfig account (pure). Variable length (String + Vec), so read sequentially. */
export function decodeMeshConfig(address: string, data: Buffer): MeshConfig {
  if (data.subarray(0, 8).toString('hex') !== MESH_CONFIG_DISCRIMINATOR) {
    throw new Error('not a MeshConfig account (bad discriminator)');
  }
  let o = 8;
  const authority = base58(data.subarray(o, o + 32));
  o += 32;
  const auditor = base58(data.subarray(o, o + 32));
  o += 32;
  const fpLen = data.readUInt32LE(o);
  o += 4;
  const modelFp = data.subarray(o, o + fpLen).toString('utf8');
  o += fpLen;
  const numLayers = data.readUInt16LE(o);
  o += 2;
  const replication = data.readUInt8(o);
  o += 1;
  const slotCount = data.readUInt32LE(o);
  o += 4;
  const slots: SlotRange[] = [];
  for (let i = 0; i < slotCount; i++) {
    slots.push({ start: data.readUInt16LE(o), end: data.readUInt16LE(o + 2) });
    o += 4;
  }
  const version = data.readUInt32LE(o);
  o += 4;
  const bump = data.readUInt8(o);
  return { address, authority, auditor, modelFp, numLayers, replication, slots, version, bump };
}

/** All registered node membership records (each node's role/trust/ban/payout/stake-pool). */
export async function getNodes(opts: RpcOptions): Promise<MeshNode[]> {
  const accounts = await rpcCall<ProgramAccount[]>(opts, 'getProgramAccounts', [
    MESH_REGISTRY_PROGRAM_ID,
    { encoding: 'base64', filters: [{ dataSize: NODE_ACCOUNT_SIZE }, { memcmp: { offset: 0, bytes: NODE_DISCRIMINATOR_B58 } }] },
  ]);
  const out: MeshNode[] = [];
  for (const acc of accounts ?? []) {
    try {
      out.push(decodeNode(acc.pubkey, Buffer.from(acc.account.data[0], 'base64')));
    } catch {
      // skip anything that isn't a well-formed Node account
    }
  }
  return out;
}

/** A single node's membership record by its ed25519 identity. Looks up by the stored identity field
 *  (offset 8) so no PDA derivation (and thus no @solana/web3.js) is needed. Null if not registered. */
export async function getNode(nodePubkey: string, opts: RpcOptions): Promise<MeshNode | null> {
  const accounts = await rpcCall<ProgramAccount[]>(opts, 'getProgramAccounts', [
    MESH_REGISTRY_PROGRAM_ID,
    { encoding: 'base64', filters: [{ dataSize: NODE_ACCOUNT_SIZE }, { memcmp: { offset: 8, bytes: nodePubkey } }] },
  ]);
  const acc = (accounts ?? [])[0];
  if (!acc) return null;
  return decodeNode(acc.pubkey, Buffer.from(acc.account.data[0], 'base64'));
}

/** The singleton topology contract (authority, auditor, model, layer slots, version). Null if the mesh
 *  config has not been initialized on this cluster. */
export async function getMeshConfig(opts: RpcOptions): Promise<MeshConfig | null> {
  const accounts = await rpcCall<ProgramAccount[]>(opts, 'getProgramAccounts', [
    MESH_REGISTRY_PROGRAM_ID,
    { encoding: 'base64', filters: [{ memcmp: { offset: 0, bytes: MESH_CONFIG_DISCRIMINATOR_B58 } }] },
  ]);
  const acc = (accounts ?? [])[0];
  if (!acc) return null;
  return decodeMeshConfig(acc.pubkey, Buffer.from(acc.account.data[0], 'base64'));
}

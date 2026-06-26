// StakePoint stake verification — pure on-chain reads (getProgramAccounts + memcmp +
// the 8-byte Anchor discriminator), ported from circuit-node-client/lib/stakepoint.js.
// StakePoint is a third-party program we only READ; nothing here writes.

import { rpcCall, type RpcOptions } from './rpc.ts';

export const STAKEPOINT_PROGRAM_ID = 'gLHaGJsZ6G7AXZxoDL9EsSWkRbKAWhFHi73gVfNXuzK';
const STAKER_ACCOUNT_SIZE = 185;
const DISCRIMINATOR = '96c5b01d37847095'; // StakerPosition account type tag
const OFFSET_WALLET = 8;
const OFFSET_POOL = 40;
const OFFSET_STAKED = 72;
const OFFSET_LOCK_UNTIL = 80;

export interface StakePosition {
  positionAddress: string;
  stakedRaw: bigint;
  lockUntil: number; // unix seconds, 0 = no lock
  lockActive: boolean;
}

interface ProgramAccount {
  pubkey: string;
  account: { data: [string, string] };
}

/** Fetch all ACTIVE (non-zero) staker positions for a wallet in a pool. A wallet can
 *  hold multiple positions; they're summed by verifyStake. */
export async function getStakePositions(
  wallet: string,
  pool: string,
  opts: RpcOptions & { now?: () => number },
): Promise<StakePosition[]> {
  const accounts = await rpcCall<ProgramAccount[]>(opts, 'getProgramAccounts', [
    STAKEPOINT_PROGRAM_ID,
    {
      encoding: 'base64',
      filters: [
        { dataSize: STAKER_ACCOUNT_SIZE },
        { memcmp: { offset: OFFSET_WALLET, bytes: wallet } },
        { memcmp: { offset: OFFSET_POOL, bytes: pool } },
      ],
    },
  ]);

  const nowSec = Math.floor((opts.now ?? Date.now)() / 1000);
  const positions: StakePosition[] = [];
  for (const acc of accounts ?? []) {
    const buf = Buffer.from(acc.account.data[0], 'base64');
    if (buf.length < STAKER_ACCOUNT_SIZE) continue;
    if (buf.subarray(0, 8).toString('hex') !== DISCRIMINATOR) continue;
    const stakedRaw = buf.readBigUInt64LE(OFFSET_STAKED);
    if (stakedRaw === 0n) continue; // unstaked-but-not-closed → ignore
    const lockUntil = Number(buf.readBigUInt64LE(OFFSET_LOCK_UNTIL));
    positions.push({
      positionAddress: acc.pubkey,
      stakedRaw,
      lockUntil,
      lockActive: lockUntil > 0 && lockUntil > nowSec,
    });
  }
  return positions;
}

export interface StakeResult {
  eligible: boolean;
  stakedAmount: number;
  stakedRaw: string;
  positionCount: number;
  lockUntil: number | null;
  lockActive: boolean;
  positions: Array<{ address: string; stakedAmount: number; stakedRaw: string; lockUntil: number; lockActive: boolean }>;
}

/** Verify a wallet has >= minAmount (human units) staked, summed across all positions.
 *  Eligibility is exact (BigInt); the float amounts are for display. */
export async function verifyStake(
  wallet: string,
  pool: string,
  minAmount: number,
  opts: RpcOptions & { decimals?: number; now?: () => number },
): Promise<StakeResult> {
  const positions = await getStakePositions(wallet, pool, opts);
  const dec = opts.decimals ?? 6;
  const div = 10 ** dec;

  if (!positions.length) {
    return { eligible: false, stakedAmount: 0, stakedRaw: '0', positionCount: 0, lockUntil: null, lockActive: false, positions: [] };
  }

  const totalRaw = positions.reduce((s, p) => s + p.stakedRaw, 0n);
  const minRaw = BigInt(Math.round((minAmount ?? 0) * div));
  const activeLocks = positions.filter((p) => p.lockActive);

  return {
    eligible: totalRaw >= minRaw,
    stakedAmount: Number(totalRaw) / div,
    stakedRaw: totalRaw.toString(),
    positionCount: positions.length,
    lockUntil: activeLocks.length ? Math.max(...activeLocks.map((p) => p.lockUntil)) : null,
    lockActive: activeLocks.length > 0,
    positions: positions.map((p) => ({
      address: p.positionAddress,
      stakedAmount: Number(p.stakedRaw) / div,
      stakedRaw: p.stakedRaw.toString(),
      lockUntil: p.lockUntil,
      lockActive: p.lockActive,
    })),
  };
}

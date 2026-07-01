// CIRC balance via getTokenAccountsByOwner (jsonParsed) — pure RPC, no @solana/web3.js.

import { CIRC_MINT } from '@circuit-llm/core';
import { rpcCall, type RpcOptions } from './rpc.ts';

interface TokenAccountsByOwner {
  value: Array<{
    account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null; amount: string } } } } };
  }>;
}

/** Total CIRC (human units) held by a wallet, summed across its token accounts. */
export async function circBalance(
  wallet: string,
  opts: RpcOptions & { mint?: string },
): Promise<number> {
  const mint = opts.mint ?? CIRC_MINT;
  const r = await rpcCall<TokenAccountsByOwner>(opts, 'getTokenAccountsByOwner', [
    wallet,
    { mint },
    { encoding: 'jsonParsed' },
  ]);
  return (r.value ?? []).reduce(
    (sum, a) => sum + (a.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    0,
  );
}

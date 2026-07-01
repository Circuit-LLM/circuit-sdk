// walletTradeExecutor — turn a self-custody Wallet into the executor that @circuit/agent's
// LocalKeypairCustody calls: buy = swap SOL→token, sell = swap token→SOL, signed + sent LOCALLY with
// the wallet's own keypair (via Jupiter). Structurally typed (no @circuit/agent import) so this stays
// a leaf package; the returned object is shape-compatible with @circuit/agent's TradeExecutor.
import { SOL_MINT } from '@circuit/core';
import type { Wallet } from './wallet.ts';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** The buy/sell shape LocalKeypairCustody hands the executor — a structural subset of @circuit/agent's `Intent`. */
export interface TradeIntent {
  kind: 'buy' | 'sell';
  /** Token mint to trade. */
  token?: string;
  /** SOL notional for a buy (also the accounted `solValue`). */
  sizeSol?: number;
  /** Token base units for a live sell. */
  amount?: number;
  maxSlippageBps?: number;
}

export interface WalletTradeResult {
  signature: string;
  solValue?: number;
}

export interface WalletExecutor {
  execute(intent: TradeIntent): Promise<WalletTradeResult>;
}

/**
 * Build a self-custody executor from a keyed {@link Wallet}. `buy` swaps SOL → token for `sizeSol`;
 * `sell` swaps `amount` (token base units) → SOL. It signs + sends with the wallet's own keypair, so
 * it is only appropriate on hardware you control. Plug it in with
 * `new LocalKeypairCustody({ executor: walletTradeExecutor(wallet), paper: false })`.
 */
export function walletTradeExecutor(wallet: Wallet): WalletExecutor {
  return {
    async execute(intent: TradeIntent): Promise<WalletTradeResult> {
      if (!intent.token) throw new Error('trade intent is missing a token mint');
      const slippageBps = intent.maxSlippageBps;
      if (intent.kind === 'buy') {
        const sol = intent.sizeSol;
        if (!(typeof sol === 'number' && sol > 0)) throw new Error('buy intent is missing a positive sizeSol');
        const lamports = BigInt(Math.round(sol * LAMPORTS_PER_SOL));
        const { sig } = await wallet.swap(SOL_MINT, intent.token, lamports, slippageBps);
        return { signature: sig, solValue: sol };
      }
      // sell: token base units → SOL
      const amount = intent.amount;
      if (!(typeof amount === 'number' && amount > 0)) throw new Error('sell intent is missing a positive amount (token base units)');
      const { sig } = await wallet.swap(intent.token, SOL_MINT, amount, slippageBps);
      return { signature: sig };
    },
  };
}

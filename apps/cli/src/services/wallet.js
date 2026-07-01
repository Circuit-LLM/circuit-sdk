// Wallet service — SOL + CIRC balances, transfers, and Jupiter swaps.
//
// Backed by @circuit-llm/wallet (which was extracted FROM this file; the SDK gained the same multi-RPC
// failover, so this is a clean swap with no lost behavior). The keystore — loading the signing key from
// ~/.circuit/id.json or CIRCUIT_WALLET — stays CLI-side in solana.js; that's CLI UX, not SDK surface.
// CIRC mint/decimals/program match @circuit-llm/core's DEFAULT_CONFIG (verified), so the SDK wallet uses the
// exact same token config. The returned Wallet has the same shape the CLI used: solBalance, circBalance,
// sendCirc, sendSol, swapQuote, swap, plus address / readOnly / keypair / connection.
import { Wallet } from '@circuit-llm/wallet';
import { loadKeypair } from './solana.js';
import { config, CIRC, SOL_MINT } from '../config.js';

export function makeWallet({ address } = {}) {
  // loadKeypair() = the CLI keystore (env or id.json); null → read-only (optionally watching `address`).
  return new Wallet({ keypair: loadKeypair(), address, rpcUrl: config.rpcUrl });
}

export const MINTS = { CIRC: CIRC.mint, SOL: SOL_MINT };

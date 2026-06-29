// services/owner-auth.js — sign control-plane requests with the wallet (owner) key.
//
// The canonical message + Ed25519 + base58 contract now lives in @circuit/core — ONE source across the
// CLI, the SDK, and circuit-agent-cloud (so headers the CLI signs always verify on the control plane;
// locked by owner-auth-consistency.test.mjs). This file is just the CLI's wallet-loading wrapper: load
// the wallet, hand its key to core's ownerAuthHeaders.
import { ownerAuthHeaders as coreOwnerAuthHeaders, ownerAuthMessage } from '@circuit/core';
import { loadKeypair } from './solana.js';

export { ownerAuthMessage };

/** Headers that authenticate this request as the wallet owner — or {} if no wallet is set (own-fleet). */
export function ownerAuthHeaders(method, fullPath, body) {
  const kp = loadKeypair();
  if (!kp) return {};
  return coreOwnerAuthHeaders(method, fullPath, body, { secretKey: kp.secretKey, address: kp.publicKey.toBase58() });
}

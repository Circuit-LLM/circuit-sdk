// One-time warning when a wallet falls back to the built-in *public* Solana RPC, which rate-limits —
// the single most common reason payments start failing under load. Kept in its own module (not re-exported
// by the package index) so the internals stay off the public API; tests import them from here directly.

import { DEFAULT_CONFIG } from '@circuit-llm/core';

/** The RPC-relevant subset of WalletOptions — a structural type, to avoid a circular import on wallet.ts. */
interface RpcSourceOpts {
  connection?: unknown;
  connections?: unknown;
  rpcUrl?: string;
  config?: { rpcUrl?: string };
}

/** True when nothing overrides the RPC, so the wallet uses the built-in public default. */
export function usesDefaultPublicRpc(opts: RpcSourceOpts): boolean {
  if (opts.connection || opts.connections || opts.rpcUrl) return false;
  return (opts.config?.rpcUrl ?? DEFAULT_CONFIG.rpcUrl) === DEFAULT_CONFIG.rpcUrl;
}

let warned = false;

/** @internal test hook — reset the once-per-process latch. Not exported from the package index. */
export function _resetRpcWarning(): void {
  warned = false;
}

/** Emit the warning at most once per process; silent when overridden or `CIRCUIT_SUPPRESS_RPC_WARNING=1`. */
export function warnIfDefaultPublicRpc(opts: RpcSourceOpts): void {
  if (warned) return;
  if (!usesDefaultPublicRpc(opts)) return;
  if (process.env.CIRCUIT_SUPPRESS_RPC_WARNING === '1') return;
  warned = true;
  console.warn(
    '[circuit-sdk] Using the public Solana RPC (api.mainnet-beta.solana.com), which rate-limits — ' +
      'calls and payments may fail under load. Set your own with makeWallet({ rpcUrl }) or the ' +
      'CIRCUIT_RPC_URL env var. Silence this with CIRCUIT_SUPPRESS_RPC_WARNING=1.',
  );
}

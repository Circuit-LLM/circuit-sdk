// @circuit/vault — the off-chain client for the non-custodial circuit-agent-vault program.
//
//   import { VaultClient, loadVaultProgram, makeVaultExecutor } from '@circuit/vault';
//   const program = loadVaultProgram(connection, wallet);
//   const vault = new VaultClient(program);
//   // makeVaultExecutor(...) plugs into @circuit/agent's VaultCustody (paper=false) to land real trades.
//
// Opt-in package: it pulls @anchor-lang/core (the SDK core stays web3-free). The bundled IDL carries its
// own program address (Anchor 1.x), so no program ID is needed here.
//
// CANONICAL HOME for the vault client (mirrors circuit-agent-vault/client/). The IDL + generated types
// under ./idl are vendored from the vault repo's `anchor build` output.
import * as anchor from "@anchor-lang/core";
import type { CircuitAgentVault } from "./idl/circuit_agent_vault.ts";
import IDL from "./idl/idl.ts";

export * from "./vault-client.ts";
export * from "./jupiter.ts";
export * from "./executor.ts";
export type { CircuitAgentVault } from "./idl/circuit_agent_vault.ts";

/** Build the vault `Program` from the bundled IDL against a connection + wallet. */
export function loadVaultProgram(connection: anchor.web3.Connection, wallet: anchor.Wallet): anchor.Program<CircuitAgentVault> {
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed", preflightCommitment: "confirmed" });
  return new anchor.Program<CircuitAgentVault>(IDL as anchor.Idl, provider);
}

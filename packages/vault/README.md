# @circuit/vault

> Drive the **non-custodial on-chain Agent Vault**: the agent's delegate key can only *trade*; you — the owner — are the sole withdraw authority, enforced on-chain. Includes a Jupiter route source and `makeVaultExecutor` for `@circuit/agent`'s `VaultCustody`.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Agents & custody →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/agents.md)

> **Opt-in package** — pulls the `@anchor-lang/core` peer dependency. Install it only if you use on-chain vault custody.

## Install

```bash
npm install @circuit/vault @anchor-lang/core
```

## Usage

Most users drive the vault through the CLI:

```bash
circuit agent vault create my-bot        # you = owner / sole withdraw authority
circuit agent vault fund my-bot 0.5
circuit agent vault withdraw my-bot 0.5  # owner-only escape hatch
```

Programmatically, `VaultClient` wraps the Anchor program (`loadVaultProgram`) with `initVault` / `deposit` / `trade` / `withdraw` / `setDelegate` / `setRoutes` / `setRule`, and `makeVaultExecutor(...)` plugs the vault into a `CircuitAgent` as its `VaultCustody` backend. Live on devnet; mainnet audit-gated.

# Circuit SDK

The developer toolkit for building on the **Circuit** decentralized-LLM ecosystem:
**x402-paid inference, data, and wallet ops**, and **hosted autonomous agents with off-box
(non-custodial) signing** — all settled per-call in CIRC.

> **Build autonomous agents that think, sense, and act on decentralized infrastructure — paid in CIRC,
> with funds that can't be stolen.**

**Status:** 🟡 spec / pre-implementation. The design lives in **[SDK.md](./SDK.md)** — read it first.

## Why

- **No API keys.** A Solana wallet *is* the account and the meter — every paid call is a CIRC micropayment (x402).
- **Decentralized inference.** A contributor-owned 72B mesh, not a single vendor.
- **Non-custodial agents.** Your strategy runs on someone else's CPU, but the signing key is off-box; the worst a host can do is an in-policy `buy`/`sell`, never a drain.
- **Earn by contributing.** The same SDK can join the mesh (GPU/CPU) and get paid.

## Planned packages

| Package | What | Status |
|---|---|---|
| `@circuit/x402` | the payment spine — pay any x402 endpoint in CIRC | extract |
| `@circuit/core` | http · config (DI) · ed25519 identity · types | extract |
| `@circuit/inference` | OpenAI-compatible client for the DLLM mesh | extract |
| `@circuit/data` | typed client for 21+ market/on-chain data endpoints | wrap |
| `@circuit/wallet` | SOL/CIRC balances, transfers, Jupiter swaps | extract |
| `@circuit/agent` | **flagship** — `CircuitAgent` base class + off-box custody + local mock + scaffold | build |
| `@circuit/node` | join/manage a mesh node from code | extract |
| `@circuit/onchain` | CIRC · StakePoint · mesh_registry reads | extract |
| `@circuit/sdk` | meta-package (re-exports) | build |
| `circuit-py` | Python consume client (inference + data + x402) | build |

## Roadmap

0. **Spine** — `@circuit/x402` + `@circuit/core`
1. **Consume SDK** — `@circuit/inference` + `@circuit/data` + `@circuit/wallet`  → the MVP
2. **Flagship** — `@circuit/agent`
3. **Contribute** — `@circuit/node` + `@circuit/onchain`

See **[SDK.md](./SDK.md)** for the full specification (architecture, per-package API, custody model,
packaging, and the grounded API reference).

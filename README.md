# Circuit SDK

The developer toolkit for building on the **Circuit** decentralized-LLM ecosystem:
**x402-paid inference, data, and wallet ops**, and **hosted autonomous agents with off-box
(non-custodial) signing** — all settled per-call in CIRC.

> **Build autonomous agents that think, sense, and act on decentralized infrastructure — paid in CIRC,
> with funds that can't be stolen.**

**Status:** 🟢 Phases 0–1 built (`@circuit/{core,x402,inference,data,wallet,sdk}` — the consume MVP).
`@circuit/agent` (the flagship) is next. The design lives in **[SDK.md](./SDK.md)**.

```bash
npm install        # workspace links + @solana/web3.js (wallet)
npm test           # 50 tests, zero-transpile (Node 22 strips TS types natively)
npm run typecheck  # tsc --noEmit, all packages
```

### Quickstart (the MVP)

```ts
import { makeWallet, Inference, Data } from '@circuit/sdk';

const wallet = makeWallet();                 // CIRCUIT_WALLET env, or pass a keypair
const ai   = new Inference({ wallet });      // pays CIRC per call (x402), automatically
const data = new Data({ wallet });

// decentralized 72B inference, streamed:
for await (const tok of ai.chatStream({ messages: [{ role: 'user', content: 'hi' }] }))
  process.stdout.write(tok);

// paid market data, one call:
const px = await data.tokenPrice('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
```

No API keys — the wallet is the account and the meter. Set `maxSpendRaw` to cap per-call spend, or
`internalKey` to bypass payment on trusted hosts.

## Why

- **No API keys.** A Solana wallet *is* the account and the meter — every paid call is a CIRC micropayment (x402).
- **Decentralized inference.** A contributor-owned 72B mesh, not a single vendor.
- **Non-custodial agents.** Your strategy runs on someone else's CPU, but the signing key is off-box; the worst a host can do is an in-policy `buy`/`sell`, never a drain.
- **Earn by contributing.** The same SDK can join the mesh (GPU/CPU) and get paid.

## Planned packages

| Package | What | Status |
|---|---|---|
| `@circuit/x402` | the payment spine — pay any x402 endpoint in CIRC; verify on-chain | ✅ built |
| `@circuit/core` | http · config (DI) · ed25519 identity · types | ✅ built |
| `@circuit/inference` | OpenAI-compatible client for the DLLM mesh | ✅ built |
| `@circuit/data` | typed client for 21+ market/on-chain data endpoints | ✅ built |
| `@circuit/wallet` | SOL/CIRC balances, transfers, Jupiter swaps | ✅ built |
| `@circuit/agent` | **flagship** — `CircuitAgent` base class + off-box custody + local mock + scaffold | next |
| `@circuit/node` | join/manage a mesh node from code | extract |
| `@circuit/onchain` | CIRC · StakePoint · mesh_registry reads | extract |
| `@circuit/sdk` | meta-package (re-exports) | ✅ built |
| `circuit-py` | Python consume client (inference + data + x402) | build |

## Roadmap

0. **Spine** — `@circuit/x402` + `@circuit/core`
1. **Consume SDK** — `@circuit/inference` + `@circuit/data` + `@circuit/wallet`  → the MVP
2. **Flagship** — `@circuit/agent`
3. **Contribute** — `@circuit/node` + `@circuit/onchain`

See **[SDK.md](./SDK.md)** for the full specification (architecture, per-package API, custody model,
packaging, and the grounded API reference).

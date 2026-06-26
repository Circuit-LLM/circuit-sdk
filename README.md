# Circuit SDK

The developer toolkit for building on the **Circuit** decentralized-LLM ecosystem:
**x402-paid inference, data, and wallet ops**, and **hosted autonomous agents with off-box
(non-custodial) signing** — all settled per-call in CIRC.

> **Build autonomous agents that think, sense, and act on decentralized infrastructure — paid in CIRC,
> with funds that can't be stolen.**

**Status:** 🟢 Phases 0–3 built — all nine packages (`core, x402, inference, data, wallet, agent, node,
onchain, sdk`). Consume, agents, and the contributor side are live. The design lives in **[SDK.md](./SDK.md)**.

```bash
npm install        # workspace links + @solana/web3.js (wallet)
npm test           # 81 tests, zero-transpile (Node 22 strips TS types natively)
npm run typecheck  # tsc --noEmit, all packages
npm run build      # tsup → dist/*.js + .d.ts (for publishing)
```

Dev resolves cross-package imports to `src/*.ts` (the `development` export condition → zero build).
Published consumers get the compiled `dist/*.js`. Each package rebuilds `dist` on `prepack`, so
`npm publish --workspaces` ships fresh JS + types.

Scaffold a new agent project: `npx circuit-agent new my-bot` (or, in this repo,
`node --experimental-strip-types --conditions=development packages/agent/bin/circuit-agent.ts new my-bot`).

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

### Write an agent (the flagship)

```ts
import { CircuitAgent } from '@circuit/agent';

class DipBot extends CircuitAgent {
  async tick() {
    // sense + think however you like, then act through off-box custody:
    const r = await this.buy('<mint>', 0.01);   // signer holds the key; buy/sell only
    if (r.ok) this.log(`bought (${r.code})`);
  }
}
new DipBot().run();   // runtime owns env wiring, heartbeat, logs, SIGTERM lifecycle
```

Run it locally and it paper-trades with **identical policy semantics** (no signer needed);
deploy it and the same code runs on a stranger's CPU where **funds can't be stolen** — the key is
off-box and the only verbs are `buy`/`sell` within policy. `npx`-able scaffold via `scaffold()`.

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
| `@circuit/agent` | **flagship** — `CircuitAgent` base class + off-box custody + local mock + scaffold | ✅ built |
| `@circuit/node` | join/manage a mesh node from code (control plane + registry) | ✅ built |
| `@circuit/onchain` | CIRC balance · StakePoint stake verification (pure RPC) | ✅ built |
| `@circuit/sdk` | meta-package (re-exports) | ✅ built |
| `circuit-py` | Python consume client (inference + data + x402) | build |

## Roadmap

0. **Spine** — `@circuit/x402` + `@circuit/core`
1. **Consume SDK** — `@circuit/inference` + `@circuit/data` + `@circuit/wallet`  → the MVP
2. **Flagship** — `@circuit/agent`
3. **Contribute** — `@circuit/node` + `@circuit/onchain`

See **[SDK.md](./SDK.md)** for the full specification (architecture, per-package API, custody model,
packaging, and the grounded API reference).

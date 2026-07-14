```
 ██████╗██╗██████╗  ██████╗██╗   ██╗██╗████████╗    ███████╗██████╗ ██╗  ██╗
██╔════╝██║██╔══██╗██╔════╝██║   ██║██║╚══██╔══╝    ██╔════╝██╔══██╗██║ ██╔╝
██║     ██║██████╔╝██║     ██║   ██║██║   ██║       ███████╗██║  ██║█████╔╝
██║     ██║██╔══██╗██║     ██║   ██║██║   ██║       ╚════██║██║  ██║██╔═██╗
╚██████╗██║██║  ██║╚██████╗╚██████╔╝██║   ██║       ███████║██████╔╝██║  ██╗
 ╚═════╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝       ╚══════╝╚═════╝ ╚═╝  ╚═╝
              S D K  ·  build on the decentralized network
```

<div align="center">

# circuit-sdk

**The developer toolkit for the Circuit decentralized intelligence network. Call the decentralized 72B, buy on-chain data, move CIRC, and ship autonomous agents that run on borrowed hardware with off-box custody — all paid per call in CIRC via x402, with no API keys. One TypeScript monorepo, plus a Python client.**

[![npm](https://img.shields.io/npm/v/@circuit-llm/sdk?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6)](https://www.typescriptlang.org)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Python](https://img.shields.io/badge/python-%3E%3D3.10-3776ab)](https://www.python.org)
[![Tests](https://img.shields.io/badge/tests-191%20passing-success)](#testing)
[![Status](https://img.shields.io/badge/status-beta-orange)](#status--roadmap)

> **Beta software.** The Circuit SDK is under active development. Expect breaking changes between releases, incomplete features, and rough edges. Agents move real value (trades + x402 payments) — use small amounts until you're comfortable with how it behaves.

[Website](https://circuitllm.xyz) · [OPS Terminal](https://circuitllm.xyz/data) · [Telegram](https://t.me/circuitllm) · [X / Twitter](https://x.com/CircuitLLM)

</div>

---

**[What it is](#what-it-is)** · **[Quick start](#quick-start)** · **[x402](#x402--pay-per-call-no-api-keys)** · **[Packages](#the-packages)** · **[CLI](#use-the-cli)** · **[MCP](#connect-the-mcp)** · **[Agents](#write-an-agent)** · **[Contribute](#contribute-a-node)** · **[How it works](#how-it-works)** · **[Docs](#docs)**

---

## What it is

Circuit is a network of decentralized, pay-per-use primitives: a contributor-owned 72B model, an on-chain data API, hosted agents with non-custodial signing, and a CPU/GPU marketplace — every call settled in **CIRC** over **x402**. The SDK is the clean way to build on all of it.

It's layered, and **an agent composes the whole stack** — it *thinks* (inference), *senses* (data), *acts* (custody), and *lives* somewhere (hosting):

- **Inference** — stream the decentralized 72B with an OpenAI-compatible client; pay per call, automatically.
- **Data** — 40+ typed market & on-chain endpoints (token price, wallet analytics, security, DeFi, real-time price feed, …) — full data-API coverage, with a generic `get()` escape hatch for anything new.
- **Wallet** — SOL + CIRC (Token-2022) balances, transfers, and Jupiter swaps.
- **x402** — the payment spine: turn any `402 Payment Required` into an on-chain CIRC micropayment + retry. No accounts, no API keys — **a wallet is the account and the meter.**
- **Agents** — write a `CircuitAgent`, implement `tick()`, and it runs on a stranger's CPU where **funds can't be stolen**: the signing key is off-box and the only verbs are `buy`/`sell` within your policy.
- **Node & on-chain** — join the mesh from code, and read CIRC balances + StakePoint stake with pure RPC.

> Most of this is *extracted from the live ecosystem*, not invented — the same x402 flow, the same custody contract, the same mesh protocol that production already runs.

---

## Quick start

**Install** — into a Node project (make one first if you're starting from scratch):

```bash
mkdir my-agent && cd my-agent   # skip if you already have a project
npm init -y                     # creates package.json — run npm inside a project, not a bare folder
npm i @circuit-llm/sdk
```

> Always install into its own folder with a `package.json`. Running `npm i` loose in your home directory (or any folder without one) makes npm walk up the tree and attach to whatever stray project it finds — a common source of confusing install errors.

**TypeScript** — the consume MVP, in five lines:

```ts
import { makeWallet, Inference, Data } from '@circuit-llm/sdk';

const wallet = makeWallet();                 // CIRCUIT_WALLET env, or pass a keypair
const ai   = new Inference({ wallet });      // pays CIRC per call (x402), automatically
const data = new Data({ wallet });

for await (const tok of ai.chatStream({ messages: [{ role: 'user', content: 'explain x402 in one line' }] }))
  process.stdout.write(tok);                 // stream the decentralized 72B

const px = await data.tokenPrice('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
```

**Python** — same idea, for the data/ML side:

```python
from circuit import Inference, Data

ai = Inference(wallet=my_wallet)             # any object with send_circ(recipient, amount_raw)
print(ai.chat([{"role": "user", "content": "hi"}])["content"])
```

**Or skip the code** — the interactive `circuit` console ships in this repo (`apps/cli`), built on the SDK:

```bash
npm install && npm run build && npm run cli   # chat · wallet · data · swarm · agent hosting, from the terminal
```

No API keys. Set `maxSpendRaw` to cap per-call spend, or `internalKey` to bypass payment on trusted hosts. Read-only data and the mesh topology need **no wallet at all**.

> **CIRC token CA:** `8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump` · [Pump.fun](https://pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump)

---

## x402 — pay per call, no API keys

x402 revives HTTP's long-dormant `402 Payment Required` as a real micropayment protocol: instead of an API key and a monthly bill, **each request pays for itself, on-chain, per call.** Every paid call in the SDK runs the same loop — and `@circuit-llm/x402` makes it one line.

| Step | What happens |
|------|--------------|
| **1 · Ask** | The client `POST`s your request with **no payment**. |
| **2 · 402** | The server replies `402 Payment Required` with the price — an amount of **CIRC** and the treasury to send it to. |
| **3 · Pay** | The client transfers that CIRC on Solana (a Token-2022 mint) and gets a transaction signature. |
| **4 · Retry** | It re-sends with `X-Payment-Signature: <txSig>`; the server verifies the on-chain payment and returns the result. |

```ts
import { X402Client } from '@circuit-llm/sdk';

const x402 = new X402Client({ wallet, maxSpendRaw: 500_000_000n });   // ≤ 500 CIRC/call
const { data } = await x402.json('https://inference.circuitllm.xyz/v1/models');
```

`X402Client` is generic — wrap *any* x402 endpoint, not just Circuit's. It's streaming-safe, has a spend cap and an approval hook, and ships the server-side `verifyPaymentTx` too, so you can gate your own endpoints with the same code. Deep dive: **[docs/x402.md](docs/x402.md)**.

---

## The packages

One npm workspace of scoped packages (`@circuit-llm/sdk` re-exports them all), plus a stdlib Python client.

| Package | What it does | Depends on |
|---------|--------------|------------|
| **`@circuit-llm/x402`** | The payment spine — pay any x402 endpoint in CIRC; verify payments server-side. **Zero deps.** | — |
| **`@circuit-llm/core`** | http · injectable config · ed25519 identity · owner-auth (per-owner control-plane request signing) · shared types. **Zero deps.** | — |
| **`@circuit-llm/inference`** | OpenAI-compatible client for the DLLM mesh (`chat`, `chatStream`, `listModels`), paid per call in CIRC (x402). | core · x402 |
| **`@circuit-llm/models`** | Client for the [circuitllm.xyz/models](https://circuitllm.xyz/models) gateway — buy prepaid credits (USDC/SOL/CIRC), mint a `sk-circuit-` key, call the metered OpenAI-compatible chat API. | core · wallet |
| **`@circuit-llm/data`** | Typed client for 40+ Circuit Data API endpoints — full coverage (free + paid), with a generic `get()` escape hatch. | core · x402 |
| **`@circuit-llm/wallet`** | SOL/CIRC balances, transfers, Jupiter swaps (multi-RPC failover); implements `PaymentWallet`; `walletTradeExecutor` drives self-custody agent trading. | core · x402 · solana |
| **`@circuit-llm/agent`** | **The agent runtime** — `CircuitAgent` base class + four custody modes (paper · self-custody · off-box signer · non-custodial vault) + verified-intent mode + scaffold. | core · inference · data · attest |
| **`@circuit-llm/attest`** | **[Verified Intents](docs/verified-intents.md)** — sign/verify evidence, the rule DSL + evaluator, and the signer's decision gate. **Zero deps** (beyond core). | core |
| **`@circuit-llm/node`** | Join/manage a mesh node from code (control plane + public registry). | core |
| **`@circuit-llm/onchain`** | CIRC balance + StakePoint stake verification + `mesh_registry` control-plane reads, via pure JSON-RPC. **No web3.js.** | core |
| **`@circuit-llm/bundle`** | Build, sign, verify & unpack content-addressed agent bundles — the canonical codec shared with the cloud + CLI; cross-platform packer + secret-file exclusion. **Zero deps.** | — |
| **`@circuit-llm/vault`** | Drive the non-custodial on-chain Agent Vault; `makeVaultExecutor` plugs into `@circuit-llm/agent`. **Opt-in (Anchor).** | anchor |
| **[`@circuit-llm/plugins`](packages/plugins#readme)** | Drop-in adapters that expose the Data API to other agent frameworks — an **ElizaOS plugin** and **Solana Agent Kit** actions. One import turns any agent into a Circuit data consumer (pay-per-call in CIRC). | core · data · x402 |
| **`@circuit-llm/sdk`** | Batteries-included meta-package — re-exports the consume + agent + contributor packages (bundle/vault are direct imports). | all |
| **`circuit-py`** | Python consume client — inference + data + x402. **Stdlib only.** | — |

Full reference: **[docs/packages.md](docs/packages.md)**.

---

## Use the CLI

Don't want to write code? The interactive **`circuit`** console ships in this repo at `apps/cli`, built on the same `@circuit-llm/*` packages — so it's also the reference app for the SDK.

```bash
npm install && npm run build && npm run cli   # then: npm link -w apps/cli  to put `circuit` on your PATH
```

Nine modules, all live; read-only ones need no wallet:

| Module | What it does | Wallet |
|--------|--------------|:------:|
| `chat` | Stream the decentralized 72B, paid per call in CIRC (x402) | required |
| `wallet` | SOL + CIRC balances, transfers, Jupiter swaps | required |
| `agent` | Create, run & host agents (local or the mesh) over off-box custody | optional |
| `data` · `swarm` · `network` · `node` · `status` · `about` | Market data + charts · swarm signals · network health · GPU onboarding · dashboard + `doctor` · about | — |

```bash
circuit chat "explain x402 in one line"      # watch the pay-per-call loop, with a cost meter
circuit data token <mint>                     # price/liquidity + braille candle chart
circuit swarm                                 # the autonomous trading agents, live
```

Guide: **[docs/cli.md](docs/cli.md)** · full command reference: **[apps/cli/docs/commands.md](apps/cli/docs/commands.md)**.

---

## Connect the MCP

Give any AI agent Circuit's real-time Solana data and **agent-swarm intelligence** as tools — **auto-paid per call in CIRC** over x402, no API keys. The **`@circuit-llm/mcp`** server (in `apps/mcp`) is a thin [MCP](https://modelcontextprotocol.io) layer over `@circuit-llm/data`; drop it into Claude Desktop, Claude Code, or any agent runtime:

```jsonc
// claude_desktop_config.json → "mcpServers"
{ "circuit": { "command": "npx", "args": ["-y", "@circuit-llm/mcp"],
    "env": { "CIRCUIT_WALLET": "<base58 secret funded with CIRC>" } } }   // omit → free tools only
```

Ten tools — free ones (`token_price`, `live_prices`, `scan`) plus paid ones led by the differentiator, **`swarm_feed`** / **`swarm_consensus`** (live signals from the running trading-agent fleet). Spend is bounded per call and per session; `CIRCUIT_TREASURY` pins the payee. Details: **[apps/mcp/](apps/mcp/README.md)**.

---

## Write an agent

The agent runtime. You extend `CircuitAgent`, implement `tick()`, and the runtime owns the rest — env wiring, off-box custody, the heartbeat, logs, and the SIGTERM lifecycle.

```ts
import { CircuitAgent } from '@circuit-llm/agent';

class DipBot extends CircuitAgent {
  async tick() {
    const trending = await this.data().tokenTrending();   // sense
    const pick = decide(trending);                        // your strategy
    if (pick) {
      const r = await this.buy(pick.mint, 0.01);          // act — off-box signer
      if (r.ok) this.log(`bought ${pick.mint} (${r.code})`);
    }
  }
}

new DipBot().run();
```

**Custody is off-box *on the mesh*.** There the agent holds only a scoped session token + epoch — never the key; `this.buy`/`this.sell` go to the signer, which holds the wallet, enforces `buy`/`sell`-only policy (max per-trade, max per-day, cooldown, allow/deny lists), and fences out a crashed instance with a monotonic epoch. On **your own** box you can instead trade **self-custody** with your own keypair (`executor: walletTradeExecutor(wallet)` → `LocalKeypairCustody`) or non-custodially through the on-chain vault — same strategy code, you pick custody by environment.

Run it locally and the same code **paper-trades with identical policy semantics** (no signer needed), trade live self-custody with your own keypair, deploy it off-box on the CPU mesh, or run it fully non-custodial through the on-chain vault — the same strategy across all four custody modes. Scaffold a project:

```bash
npx circuit-agent new my-bot
```

### Trust & safety

Your agent runs on a stranger's CPU, and the protections hold anyway:

- **No drain.** The signer's only verbs are `buy`/`sell` — no transfer/withdraw — so a hostile host can never move funds out. Period.
- **No forged trades** — with **[Verified Intents](docs/verified-intents.md)**. Commit a decision rule, and the signer re-runs it on *authenticated* inputs (signed data / inference receipts / zkTLS) and signs **only** the trade that rule produces. A host that fully controls the agent still can't make it trade on its own terms — a tampered agent, faked data, or a host-chosen trade is rejected before signing. Pure software, any CPU.
- **Works for any strategy.** Verified Intents covers any rule the signer can re-check — which is most agents (deterministic, or a rule over a signed-AI verdict). For a genuine black box, run it in a TEE with **Sealed Agents**.

Full guide — custody, lifecycle, the host can/can't table, the inference-payment vs. trading-custody distinction: **[docs/agents.md](docs/agents.md)**.

---

## Contribute a node

The same SDK that *consumes* the network can *join* it — and read what's staked on-chain.

```ts
import { MeshControl, generateMeshIdentity, verifyStake } from '@circuit-llm/sdk';

const id = generateMeshIdentity();
const mesh = new MeshControl({ controlUrl: 'http://control:18932', identity: id });
const { assignment } = await mesh.register({ endpoint: ['1.2.3.4', 5000], capacityLayers: 40, modelFp: 'qwen2.5-72b-awq' });
await mesh.ready();   // …then heartbeat; the heavy GPU serving lives in the node image

const stake = await verifyStake(wallet, pool, 100_000, { rpcUrl });   // ≥ 100k CIRC staked?
```

`@circuit-llm/node` speaks both the inference-mesh control plane (register/heartbeat) and the public node registry (announce/ping); `@circuit-llm/onchain` reads stake + CIRC balances with no `@solana/web3.js`. Details: **[docs/contributing-a-node.md](docs/contributing-a-node.md)**.

---

## How it works

A pnpm/npm-workspaces TypeScript monorepo. **x402 is the spine; everything paid depends on it; everything depends on core.**

```
packages/
  x402/      the payment spine (402 → pay CIRC → retry · verify)   ← zero deps
  core/      http · config (DI) · ed25519 identity · types         ← zero deps
  inference/ │ data/ │ wallet/        the consume layer
  models/    circuitllm.xyz/models gateway client (prepaid credits · OpenAI-compatible)
  agent/     CircuitAgent + off-box custody + scaffold (the agent runtime)
  node/      │ onchain/               the contributor layer
  bundle/    │ vault/                 agent bundles · non-custodial vault client (opt-in)
  sdk/       meta-package (re-exports the consume + agent + contributor packages)
apps/
  cli/       the `circuit` terminal console — built ON the SDK (npm run cli)
  mcp/       the MCP server — Circuit data + swarm intel as x402-paid agent tools (npx @circuit-llm/mcp)
circuit-py/  Python consume client (inference + data + x402)
```

**Zero-build dev, compiled publishing.** Conditional exports resolve cross-package imports to `src/*.ts` for development (Node 22's native type-stripping — no transpile step) and to compiled `dist/*.js` for consumers. Tests run straight off TypeScript:

```bash
npm install
npm test            # 196 TS tests, zero-transpile
npm run typecheck   # tsc --noEmit, all 14 packages
npm run build       # tsup → dist/*.js + .d.ts (publishing)
cd circuit-py && python3 -m unittest discover -s tests   # 12 Python tests
```

Design principles, the dependency graph, and the build model are in **[docs/architecture.md](docs/architecture.md)**.

---

## Status & roadmap

**Beta.** All fourteen TypeScript packages + the `circuit` CLI and MCP server (in `apps/`) + the Python client are built, extracted faithfully from the live ecosystem, and covered by **208 tests** (196 TS + 12 Python), all typecheck-clean. The CLI lives in the monorepo and consumes `@circuit-llm/*` directly, so the SDK is the single source for the shared logic (bundle codec, wallet, owner-auth). The full roadmap — spine → consume → agents → contributor → extended (bundles · vault · on-chain control-plane reads) — is complete.

Working today: paid inference and data, CIRC wallet operations, the `CircuitAgent` runtime across the full custody spectrum (paper, self-custody, off-box signer, and the on-chain vault client), the mesh and registry clients, and on-chain stake reads. Planned: streaming and a native Solana `PaymentWallet` for the Python client.

---

## Docs

- **[docs/getting-started.md](docs/getting-started.md)** — install, connect a wallet, your first paid call (TS + Python)
- **[docs/packages.md](docs/packages.md)** — every package's API surface
- **[docs/cli.md](docs/cli.md)** — the `circuit` terminal console (modules, commands, config) → deep dive in **[apps/cli/](apps/cli/README.md)**
- **[apps/mcp/](apps/mcp/README.md)** — the **`@circuit-llm/mcp`** server: Circuit data + swarm intel as x402-paid agent tools
- **[docs/x402.md](docs/x402.md)** — the payment spine, client + server
- **[docs/agents.md](docs/agents.md)** — write + host an agent, the four custody modes in depth
- **[docs/verified-intents.md](docs/verified-intents.md)** — commit a decision rule; the signer signs only the trade that rule produces
- **[docs/contributing-a-node.md](docs/contributing-a-node.md)** — join the mesh, read stake on-chain
- **[docs/architecture.md](docs/architecture.md)** — design principles, the monorepo, the dual-mode build

> **`npm audit` after install** reports **3 high** advisories — all transitive dependencies of the Solana SDK (`bigint-buffer` in `@solana/spl-token`'s u64 decoder), with no upstream fix and not reachable from untrusted input here. **Do not run `npm audit fix --force`** — it downgrades `@solana/web3.js`/`spl-token` to 2019-era versions and breaks the build. The `uuid` and `esbuild` advisories are already pinned out via `overrides` in the root [package.json](package.json). Details: **[apps/cli/SECURITY.md](apps/cli/SECURITY.md#dependencies--npm-audit)**.

---

## Community

[Website](https://circuitllm.xyz) · [OPS Terminal](https://circuitllm.xyz/data) · [Telegram](https://t.me/circuitllm) · [X / Twitter](https://x.com/CircuitLLM)

Part of the Circuit ecosystem. The `circuit` terminal CLI now ships **in this repo** (`apps/cli`), built on the SDK — alongside [circuit-agent-cloud](https://github.com/Circuit-LLM/circuit-agent-cloud) (agent hosting), the on-chain **Agent Vault** (non-custodial trading custody), and the decentralized DLLM engine.

---

## License

MIT © Circuit LLM — see [LICENSE](LICENSE).

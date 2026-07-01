```
 ██████╗██╗██████╗  ██████╗██╗   ██╗██╗████████╗
██╔════╝██║██╔══██╗██╔════╝██║   ██║██║╚══██╔══╝
██║     ██║██████╔╝██║     ██║   ██║██║   ██║
██║     ██║██╔══██╗██║     ██║   ██║██║   ██║
╚██████╗██║██║  ██║╚██████╗╚██████╔╝██║   ██║
 ╚═════╝╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝
        L L M  ·  decentralized intelligence
```

<div align="center">

# circuit-cli

**The command line for the Circuit LLM decentralized intelligence network. Chat with the decentralized 72B, manage the CIRC that pays for it, watch the mesh and the agent swarm, query on-chain data, and contribute a GPU — all from one beautiful terminal.**

[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-0.2.1-blue)](https://github.com/Circuit-LLM/circuit-sdk/releases)
[![Status](https://img.shields.io/badge/status-beta-orange)](https://github.com/Circuit-LLM/circuit-sdk)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

> **Beta software.** circuit-cli is under active development. Expect breaking changes between releases, incomplete features, and rough edges. Chat spends real CIRC and agents trade real funds — start small until you're comfortable with how it behaves.

[Website](https://circuitllm.xyz) · [OPS Terminal](https://circuitllm.xyz/data) · [Telegram](https://t.me/circuitllm) · [X / Twitter](https://x.com/CircuitLLM)

</div>

---

**[What it does](#what-it-does)** · **[Quick Start](#quick-start)** · **[Connect a wallet](#connect-a-wallet)** · **[Chat](#chat--x402-made-visible)** · **[Commands](#commands)** · **[Modules](#modules)** · **[Config](#configuration)** · **[How it works](#how-it-works)** · **[Docs](#docs)**

---

## What it does

- **Chats with the decentralized 72B** — stream completions from Circuit's model, served across a mesh of independent GPUs and paid per request in CIRC via x402. One-shot, piped, or a full interactive REPL with a live cost meter.
- **Manages your CIRC** — SOL + CIRC (Token-2022) balances, transfers, and SOL↔CIRC swaps via Jupiter. Connect a key, generate a fresh one, or run read-only against any address.
- **Watches the network** — Solana throughput, the inference gateway's health, and a one-glance `doctor` that checks every service in the ecosystem.
- **Follows the swarm** — the autonomous trading agents' stats, leaderboard, and a live feed of buy/sell signals, straight from the public registry.
- **Reads the market** — token price, liquidity, trending lists, dip scanner, and **braille candle charts** rendered right in the terminal.
- **Onboards a GPU** — the one-line command to attach a machine to the mesh and earn from the inference it serves.
- **Looks and feels good** — a gradient splash, aligned panels, and a keyboard-driven menu. The design system is a first-class concern, not an afterthought.

---

## Before you start

| What | Why | Where |
|------|-----|-------|
| **Node.js ≥ 18** | Runtime (uses native `fetch`) | [nodejs.org](https://nodejs.org) |
| **A Solana wallet** | Sign chat payments, send & swap | Generate one in-app (`circuit wallet generate`) or import an existing key |
| **CIRC + a little SOL** | Chat pays ~$0.03 in CIRC per request; SOL covers tx fees | Earn it, swap for it (in `circuit wallet`), or buy on Pump.fun |

Read-only features (market data, the swarm, network health) need **no wallet at all**.

> **CIRC token CA:** `8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump`
> **Buy on Pump.fun:** [pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump](https://pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump)

---

## Quick Start

The CLI ships inside the **circuit-sdk** monorepo (`apps/cli`) and runs on the `@circuit-llm/*` packages:

```bash
git clone https://github.com/Circuit-LLM/circuit-sdk
cd circuit-sdk
npm install
npm run build            # build the @circuit-llm/* packages the CLI imports

npm run cli              # open the interactive console
# or, to expose `circuit` globally:  npm link -w apps/cli
```

> `npm install` reports **3 high** advisories — the `bigint-buffer` chain from the **Solana SDK's transitive dependencies**, known and not exploitable here. **`npm audit fix --force` will break the build** (it downgrades the SDK to 2019 versions). See [SECURITY.md](SECURITY.md#dependencies--npm-audit).

Or jump straight to anything:

```bash
circuit chat "explain x402 in one line"
circuit data token 8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump
circuit swarm
circuit status doctor
circuit --help
```

---

## Connect a wallet

The CLI signs transactions with a local Solana keypair. It loads one in this order:

1. **`CIRCUIT_WALLET`** environment variable — a base58 secret key (nothing written to disk)
2. **`~/.circuit/id.json`** — a standard Solana keypair file (`0600`, owner-only)

The friendly way:

```bash
circuit wallet import      # paste a base58 key (hidden) → saved to ~/.circuit/id.json
circuit wallet generate    # create a fresh keypair, with a one-time secret reveal for backup
circuit wallet address     # show the loaded wallet
circuit wallet balance     # SOL + CIRC
```

Read-only? Pass an address — no key needed:

```bash
circuit wallet balance <pubkey>
```

> Your secret key is **never printed or logged**. Sends, swaps, and paid chat always confirm before acting. See **[SECURITY.md](SECURITY.md)**.

---

## Chat — x402, made visible

Chat is the easiest way to **watch x402 work**. x402 revives HTTP's long-dormant `402 Payment Required` status as a real micropayment protocol: instead of an API key and a monthly bill, each request pays for itself, on-chain, per call. The whole Circuit network runs on it — chat just makes the handshake something you can see, turn by turn.

Every message runs the full loop:

| Step | What happens |
|------|--------------|
| **1 · Ask** | The CLI `POST`s your prompt to the inference gateway with **no payment**. |
| **2 · 402** | The gateway replies `402 Payment Required` with the price — an amount of **CIRC** and the treasury address to send it to. |
| **3 · Pay** | The CLI transfers that CIRC to the treasury on Solana (CIRC is a Token-2022 mint) and gets a transaction signature. |
| **4 · Retry** | It re-sends the request with `X-Payment-Signature: <txSig>`. The gateway verifies the on-chain payment and streams the model's reply. |

```bash
circuit chat                              # interactive REPL
circuit chat "what is a falling knife?"   # one-shot, streams
cat error.log | circuit chat "debug this" # pipe stdin
circuit chat --json "..."                 # raw JSON (scriptable)
circuit chat --system "be terse" "..."    # override the system prompt
circuit chat --models                     # list available models
```

The last line of every turn is your **receipt** — the CIRC spent, the dollar value, and the on-chain transaction you can look up:

```
circuit › Circuit LLM is a decentralized intelligence network…
  ↯ 361.00 CIRC  ·  $0.03  ·  tx 2zgfAS…qb44
```

No accounts, no keys, no invoices — the request paid for itself (~$0.03). Because the same pattern powers the rest of the network (the data API charges identically), the chat doubles as a **reference implementation**: the generic pay-and-retry lives in [`src/services/x402.js`](src/services/x402.js), the streaming version in [`src/services/inference.js`](src/services/inference.js), and the full request lifecycle is diagrammed in [ARCHITECTURE.md](ARCHITECTURE.md#a-request-paid-chat-x402).

---

## Commands

| Command | What it does |
|---------|--------------|
| `circuit` | Interactive console (splash + menu) |
| `circuit chat [prompt]` | DLLM chat — REPL, one-shot, or piped; `--json --model --temp --system --max-tokens --models` |
| `circuit wallet` | Balances, receive, send, swap (interactive) |
| `circuit wallet import \| generate \| address \| balance [addr]` | Wallet setup & queries |
| `circuit data trending \| dips \| token <mint>` | Market data + braille charts |
| `circuit swarm` · `swarm feed` | Trading-swarm stats, leaderboard, live signals |
| `circuit agent create \| start \| stop \| list \| status \| logs \| destroy` | Launch & manage agents (local or on the mesh) |
| `circuit agent host` | Contribute CPU to the agent cloud — drives a local node-client (`--status`, `--off`) |
| `circuit network` · `network watch` | Solana + inference-gateway health |
| `circuit node join` | One-line GPU onboarding |
| `circuit status` · `status doctor` | Dashboard + connectivity check |
| `circuit about` | About the Circuit network |

Full reference: **[docs/commands.md](docs/commands.md)**.

---

## Modules

| Module | What it does | Wallet | Status |
|--------|--------------|:------:|--------|
| `chat` | Stream the decentralized 72B, paid in CIRC | required | live |
| `wallet` | SOL + CIRC balances, send, swap | required | live |
| `data` | Token price/liquidity, trending, dips, charts | — | live |
| `swarm` | Autonomous agents — stats & live signals | — | live |
| `agent` | Launch autonomous agents (local or the mesh cloud), off-box custody; `host` lends CPU via a local node-client | optional | live |
| `network` | Solana TPS + inference-gateway health | — | live |
| `node` | One-command GPU onboarding | — | live |
| `status` | One-glance dashboard + `doctor` | — | live |
| `about` | About the Circuit network | — | live |

The swarm registry is served publicly from `api.circuitllm.xyz`. Some market/network data is x402-gated by the network and may require the paid data API away from the coordinator host — see **[docs/configuration.md](docs/configuration.md#endpoints)**.

---

## Configuration

User config lives at `~/.circuit/config.json` (created on demand):

```json
{
  "rpcUrl": "https://your-rpc-provider",
  "inferenceModel": "circuit",
  "output": "pretty"
}
```

Environment overrides:

| Variable | Purpose |
|----------|---------|
| `CIRCUIT_WALLET` | base58 secret key (takes precedence over the keyfile) |
| `CIRCUIT_RPC_URL` | Solana RPC endpoint (public RPCs rate-limit — set your own for heavy use) |

Full details — endpoints, the system prompt, RPC fallback — in **[docs/configuration.md](docs/configuration.md)**.

---

## How it works

Three layers, one rule — **`services` talk, `ui` draws, `modules` glue:**

```
src/
  index.js  config.js
  core/      context · registry · menu · splash · render
  services/  http · solana · wallet · x402 · inference · priceFeed · circuitNode · node · agents · bundle · vault · owner-auth · drivers/{local,cloud}
  ui/        banner · layout · components · screen · chart · prompts
  modules/   chat · wallet · data · swarm · agent · network · node · status · about
  util/      async · format
```

`core/registry.js` is the single source of truth — both the interactive menu and the command verbs are generated from it, so they never drift. Adding a feature is one `services` method + one `modules` screen + a line in the registry. The full design is in **[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Docs

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the layered architecture in depth
- **[docs/commands.md](docs/commands.md)** — full command reference
- **[docs/configuration.md](docs/configuration.md)** — config, wallet, endpoints, RPC
- **[SECURITY.md](SECURITY.md)** — wallet & key safety
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — add a module or a service

---

## Community

[Website](https://circuitllm.xyz) · [OPS Terminal](https://circuitllm.xyz/data) · [Telegram](https://t.me/circuitllm) · [X / Twitter](https://x.com/CircuitLLM)

Part of the Circuit ecosystem — alongside [circuit-agent](https://github.com/Circuit-LLM/circuit-agent) (the trading swarm) and the decentralized DLLM engine.

---

## License

MIT © Circuit LLM — see [LICENSE](LICENSE).

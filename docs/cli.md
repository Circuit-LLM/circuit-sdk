# The `circuit` CLI

The interactive terminal console for the Circuit network. It ships **inside this monorepo** at
[`apps/cli`](../apps/cli) and is built directly on the `@circuit/*` packages — the same x402 flow,
wallet, bundle codec, and owner-auth the SDK exposes. If the SDK is the library, the CLI is the
reference application that proves it.

> This page is the top-level orientation. The CLI's own docs go deeper:
> [apps/cli/README.md](../apps/cli/README.md) ·
> [command reference](../apps/cli/docs/commands.md) ·
> [configuration](../apps/cli/docs/configuration.md) ·
> [architecture](../apps/cli/ARCHITECTURE.md) ·
> [security](../apps/cli/SECURITY.md).

## Run it

The CLI runs on the built `@circuit/*` packages, so build once after cloning:

```bash
git clone https://github.com/Circuit-LLM/circuit-sdk
cd circuit-sdk
npm install
npm run build          # compile the @circuit/* packages the CLI imports

npm run cli            # open the interactive console
# expose `circuit` on your PATH:  npm link -w apps/cli
```

Then jump straight to anything:

```bash
circuit chat "explain x402 in one line"
circuit data token 8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump
circuit swarm
circuit status doctor
circuit --help
```

Read-only features (market data, the swarm, network health) need **no wallet at all**. Chat and the
wallet/agent verbs need a Solana keypair — see [Connect a wallet](../apps/cli/README.md#connect-a-wallet).

## Modules

Nine modules, all live. The interactive menu and the command verbs are generated from one registry
(`src/core/registry.js`), so they never drift.

| Module | What it does | Needs a wallet |
|--------|--------------|:--------------:|
| `chat` | Stream the decentralized 72B, paid per request in CIRC over x402 | required |
| `wallet` | SOL + CIRC (Token-2022) balances, transfers, Jupiter swaps | required |
| `data` | Token price/liquidity, trending, dips, braille candle charts | — |
| `swarm` | The autonomous trading agents — stats, leaderboard, live signal feed | — |
| `agent` | Create & run agents (local or the mesh cloud) over off-box custody; `host` contributes CPU | optional |
| `network` | Solana throughput + inference-gateway health | — |
| `node` | One-command GPU onboarding to the inference mesh | — |
| `status` | One-glance dashboard + `doctor` connectivity check | — |
| `about` | About the Circuit network | — |

### Contributing CPU (`agent host`)

The runtime that hosts agents is the **Circuit node-client** — it bundles and supervises the agent-host. So `circuit agent host` **drives a locally-running node-client** over its localhost API (the same Connect/disconnect the node-client dashboard's Cloud tab uses); `--status` then reports `via node-client`. Install one with `curl -fsSL https://circuitllm.xyz/join | bash`. If no node-client is running, the CLI falls back to a local `circuit-agent-cloud` checkout (`CIRCUIT_AGENT_CLOUD_DIR`) for operators. Full reference: [contribute capacity](../apps/cli/docs/commands.md#contribute-capacity-operator).

## Chat is x402, made visible

Every chat turn runs the full pay-per-call loop — ask → `402` with a CIRC price → pay on-chain →
retry with the tx signature → stream the reply — and prints the receipt as a cost meter:

```
circuit › Circuit LLM is a decentralized intelligence network…
  ↯ 361.00 CIRC  ·  $0.03  ·  tx 2zgfAS…qb44
```

No accounts, no API keys — the request paid for itself. The generic pay-and-retry lives in
[`apps/cli/src/services/x402.js`](../apps/cli/src/services/x402.js) and is the same logic
[`@circuit/x402`](./x402.md) packages for libraries. Full command list:
[command reference](../apps/cli/docs/commands.md).

## Configuration

User config lives at `~/.circuit/config.json` (created on demand); the wallet loads from
`CIRCUIT_WALLET` (a base58 secret, nothing written to disk) or `~/.circuit/id.json` (`0600`). Env
overrides: `CIRCUIT_WALLET`, `CIRCUIT_RPC_URL`. Details:
[configuration](../apps/cli/docs/configuration.md).

## How it builds on the SDK

The CLI imports `@circuit/core` (owner-auth), `@circuit/wallet` (the wallet + multi-RPC failover),
and `@circuit/bundle` (the content-addressed bundle codec) rather than carrying its own copies — so
the shared logic has exactly one source of truth in the SDK. Adding a feature is one `services`
method + one `modules` screen + a registry line; the layered design is in
[ARCHITECTURE.md](../apps/cli/ARCHITECTURE.md).

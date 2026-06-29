# Command Reference

Run `circuit` with no arguments for the interactive console, or any verb below to jump straight to it. Every screen is also reachable from the menu.

```bash
circuit            # interactive console
circuit <verb>     # run one thing
circuit --help     # list everything
circuit --version
```

---

## chat

Talk to the decentralized 72B. Paid in CIRC via x402 (~$0.03 / request) — needs a [connected wallet](configuration.md#wallet).

```bash
circuit chat                      # interactive streaming REPL (/exit to leave)
circuit chat "your prompt"        # one-shot, streams to stdout
cat file.txt | circuit chat "summarize this"
```

| Option | Description |
|--------|-------------|
| `--json` | Output raw JSON (non-streaming) — scriptable |
| `-m, --model <id>` | Model id (default: `circuit`) |
| `-t, --temp <n>` | Temperature |
| `-s, --system <prompt>` | Override the default Circuit system prompt |
| `--max-tokens <n>` | Max tokens to generate |
| `--models` | List available models and exit |

Each turn prints a cost meter: `↯ <amount> CIRC · $<usd> · tx <sig>`.

---

## wallet

Balances and transfers. The signing key loads from `CIRCUIT_WALLET` or `~/.circuit/id.json` ([details](configuration.md#wallet)).

```bash
circuit wallet                    # interactive (balances, receive, send, swap, connect)
circuit wallet balance [address]  # SOL + CIRC; pass an address for read-only
circuit wallet import             # paste a base58/byte-array key → saved 0600
circuit wallet generate           # create a fresh keypair (one-time secret reveal)
circuit wallet address            # show the loaded address
```

Inside the interactive screen you can also **send** (CIRC or SOL) and **swap** (SOL ↔ CIRC via Jupiter) — both confirm the amount before signing.

---

## data

On-chain market intelligence.

```bash
circuit data                      # interactive (trending / dips / lookup)
circuit data trending             # most active tokens, priced
circuit data dips                 # tokens pulling back now (5m)
circuit data token <mint>         # price, liquidity, and a braille candle chart
```

> Some market data is x402-gated by the network and is free only on the coordinator host — see [endpoints](configuration.md#endpoints).

---

## swarm

The autonomous trading agents, from the public registry at `api.circuitllm.xyz`.

```bash
circuit swarm                     # stats, leaderboard, recent signals
circuit swarm feed                # the live signal feed
```

---

## agent

Launch autonomous agents and run them locally or on the **agent cloud** (the Circuit mesh's spare CPU). Requires the [circuit-agent-cloud](https://github.com/Circuit-LLM/circuit-agent-cloud) services for the cloud path.

```bash
circuit agent                       # interactive dashboard
circuit agent create <name>         # create (local by default)
circuit agent create <name> --cloud # ...or host it on the mesh
circuit agent start <name>          # start it
circuit agent list                  # status, P&L, where it runs
circuit agent status <name>         # detail + custody, wallet, paper P&L
circuit agent logs <name> [--tail n]
circuit agent stop <name>
circuit agent destroy <name> [--yes]
```

`create` options: `--cloud`, `--workload <agentd|circuit-agent>`, `--interval <ms>`, `--strategy <s>`, and the custody policy — `--max-trade <sol>`, `--max-daily <sol>`, `--cooldown <ms>`, `--live` (paper by default).

### Custody

A `--cloud` agent's signing key lives **off-box** in the signer, never on the operator that runs it. On create you get a **wallet address** — fund it, then start. The agent can only trade by asking custody to sign, and the signer enforces your policy (max SOL per trade/day, cooldown) and signs `buy`/`sell` only — funds can never leave the wallet through the agent, so a host can't drain it. `status` shows the wallet, the limits, and `paper`/`LIVE`.

Agents run **paper** until you create them with `--live`. A live agent's trades are built by the signer from the approved intent (taker = its own wallet), signed with the off-box key, and landed via **Jupiter Ultra** — so the host never touches the key and the signer only ever signs a swap of the agent's own funds. Fund the wallet before going live.

### Contribute capacity (operator)

Lend spare CPU to the cloud and host other users' agents — opt-in, bounded, revocable:

```bash
circuit agent host --max-agents 20   # start contributing (default off)
circuit agent host --status
circuit agent host --off             # drain + stop
```

Point at a control plane with `CIRCUIT_CONTROL_PLANE=<url>`. See the [agent-cloud spec](agent-cloud-spec.md). If you also run a [circuit-node-client](https://github.com/Circuit-LLM/circuit-node-client), its **Cloud** tab shows what this node is hosting.

---

## network

Chain + mesh health.

```bash
circuit network                   # Solana TPS/version + inference-gateway status
circuit network watch             # live-refreshing view (Ctrl-C to exit)
```

---

## node

Contribute a GPU to the mesh.

```bash
circuit node            # what joining does + the one-line installer
circuit node join       # show the install command
```

---

## status

Cross-cutting views.

```bash
circuit status          # one-glance dashboard: mesh, model, CIRC price, wallet
circuit status doctor   # connectivity check across every service (with latencies)
```

`doctor` is the fastest way to confirm everything is reachable:

```
● Inference gateway  259ms
● circuit-node  7ms
● price-feed  65ms
● Data gateway  11ms
● Solana RPC  45ms
```

---

## about · menu

```bash
circuit about     # about the Circuit network
circuit menu      # open the interactive console (same as bare `circuit`)
```

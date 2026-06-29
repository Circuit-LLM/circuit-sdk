# Configuration

circuit-cli works out of the box with sensible defaults. Everything below is optional — set only what you need.

---

## User config

A JSON file at **`~/.circuit/config.json`**, merged over the built-in defaults (created on demand; missing keys fall back):

```json
{
  "rpcUrl": "https://your-rpc-provider.example/...",
  "inferenceModel": "circuit",
  "output": "pretty",
  "systemPrompt": "You are Circuit, the assistant for Circuit LLM…"
}
```

| Key | Default | Purpose |
|-----|---------|---------|
| `rpcUrl` | a public Solana RPC | RPC for balances, transfers, swaps |
| `inferenceModel` | `circuit` | Model id sent to the inference gateway |
| `output` | `pretty` | Reserved for `json` machine output |
| `systemPrompt` | a Circuit-aware prompt | Default chat system message |

---

## Environment overrides

| Variable | Purpose |
|----------|---------|
| `CIRCUIT_WALLET` | base58 secret key — **takes precedence** over the keyfile |
| `CIRCUIT_RPC_URL` | Solana RPC endpoint — overrides `rpcUrl` |

```bash
export CIRCUIT_RPC_URL="https://your-rpc"
export CIRCUIT_WALLET="<base58-secret-key>"
circuit chat "hello"
```

---

## Wallet

The CLI signs with a local Solana keypair, loaded in this order:

1. **`CIRCUIT_WALLET`** env var (base58) — nothing written to disk.
2. **`~/.circuit/id.json`** — a standard Solana keypair file, owner-only (`0600`), in a `0700` directory.

Set one up:

```bash
circuit wallet import      # paste a base58/byte-array key (hidden)
circuit wallet generate    # create a fresh keypair, with a one-time backup reveal
circuit wallet address     # confirm what's loaded
```

Read-only features (`data`, `swarm`, `network`, `wallet balance <addr>`) need **no** wallet. Writes (`send`, `swap`, paid `chat`) require one and confirm before acting. See [SECURITY.md](../SECURITY.md).

---

## RPC & fallback

Reads and transactions go through the configured RPC. Public RPCs rate-limit aggressively — **set your own** (`CIRCUIT_RPC_URL`) for anything beyond casual use.

On a `429` or a stall, the wallet automatically falls back across public RPCs (`solana.js → withRpc`). Re-broadcasting a signed transaction is idempotent, so the fallback is safe for sends as well as reads — a capped primary RPC won't break a payment.

---

## Endpoints

Defaults (override the whole `endpoints` object in `config.json` if you self-host):

| Endpoint | Default | Notes |
|----------|---------|-------|
| `inference` | `inference.circuitllm.xyz/v1` | DLLM chat (OpenAI-compatible, x402-paid) |
| `nodePublic` | `api.circuitllm.xyz` | Public swarm registry (read-only) |
| `data` | `api.circuitllm.xyz` | x402 data gateway |
| `join` | `circuitllm.xyz/join` | GPU installer script |
| `node` | `localhost:18940` | circuit-node (coordinator-local) |
| `priceFeed` | `localhost:18941` | price-feed (coordinator-local) |

### What's public vs paid

- **Public, free:** chat handshake & models, the **swarm registry** (`/api/swarm/*` via `api.circuitllm.xyz`), the GPU join script, and client-side wallet reads.
- **x402-paid:** inference (per request, in CIRC), and the data gateway's market endpoints.
- **Coordinator-local:** some `circuit-node` market/network data (`/api/network`, `/api/trending`) is free only on the coordinator host — the network x402-gates it for outside callers by design. The `data` and `network` modules try the local port first and fall back to the public API, so they're fully featured on the host and degrade gracefully elsewhere.

---

## System prompt

Chat prepends a default Circuit-aware system message so the model represents the network accurately. Override it per call with `circuit chat --system "…"`, or globally via `systemPrompt` in `config.json`.

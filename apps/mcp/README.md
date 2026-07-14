# @circuit-llm/mcp

An **MCP server** that exposes Circuit's real-time Solana data and **agent-swarm intelligence** as tools any
AI agent can call — and **auto-pays for per call in CIRC via x402**. No API keys, no signup.

It's a thin layer over [`@circuit-llm/data`](../../packages/data), which already speaks x402: free endpoints
return data directly, paid endpoints are auto-paid from your wallet (capped per call).

## Use it (Claude Desktop / Claude Code)

```jsonc
// claude_desktop_config.json → "mcpServers"
{
  "circuit": {
    "command": "npx",
    "args": ["-y", "@circuit-llm/mcp"],
    "env": {
      "CIRCUIT_WALLET": "<base58 secret key funded with CIRC>",   // omit for free tools only
      "CIRCUIT_MCP_MAX_SPEND_CIRC": "1000"                        // per-call cap (optional)
    }
  }
}
```

Then ask your agent things like *"check the swarm's consensus on this mint"* or *"audit this token for rug
risk"* — the paid tools settle on Solana in ~400ms behind the scenes.

## Tools

| Tool | Cost | What |
|---|---|---|
| `circuit_quote` | free | live price list for every tool |
| `token_price` | free | aggregated USD price |
| `live_prices` | free | sub-second batch prices (≤20 mints) from the gRPC indexer |
| `scan` | free | on-chain dip-reversal scanner |
| `swarm_feed` ⭐ | ~$0.002 | live buy/sell/rug signals from the Circuit agent swarm |
| `swarm_consensus` ⭐ | ~$0.002 | reputation-weighted swarm view on one token |
| `token_security` | ~$0.003 | rug-risk audit (authorities, LP lock, flags) |
| `token_overview` | ~$0.003 | price + metadata + security + pools in one call |
| `trending` | ~$0.002 | trending tokens across sources |
| `token_holders` | ~$0.005 | holder count + top-5/10/20 concentration |

The `swarm_*` tools are the differentiator — live signals from a running trading-agent fleet, data no
generic price API has.

## Config (env)

| Var | Default | Purpose |
|---|---|---|
| `CIRCUIT_WALLET` | — | base58 secret key that funds micropayments (omit → free tools only) |
| `CIRCUIT_MCP_MAX_SPEND_CIRC` | `1000` | per-**call** CIRC spend cap |
| `CIRCUIT_MCP_MAX_TOTAL_CIRC` | `50000` | per-**process** CIRC cap — the runaway-spend guard; paid tools stop once reached |
| `CIRCUIT_MCP_TIMEOUT_MS` | `30000` | per-tool-call timeout (a stalled upstream returns a clean error) |
| `CIRCUIT_TREASURY` | — | if set, only ever pay this address (recipient allow-list — recommended) |
| `CIRCUIT_DATA_URL` | `https://api.circuitllm.xyz` | override the data API base |

## Safety

- Every paid call is bounded by `CIRCUIT_MCP_MAX_SPEND_CIRC`; set `CIRCUIT_TREASURY` to pin the payee.
- All tools are **read-only** data fetches — they move no funds beyond the micropayment.
- Logs go to stderr; stdout is reserved for the MCP protocol.

Run the smoke test: `npm run smoke` (spawns the server, lists tools, exercises free tools — no spend).

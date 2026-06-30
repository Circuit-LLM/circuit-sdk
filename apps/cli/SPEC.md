# circuit-cli — Spec & Plan

> The command line for the **Circuit LLM** decentralized intelligence network.
> A design-first terminal console: chat with the decentralized 72B, manage the
> CIRC that pays for it, watch the mesh and the agent swarm, query on-chain data,
> and contribute a GPU — all from one beautiful CLI.

## 1. Principles

1. **Design-first.** Every screen is composed from one design system (`theme.js`
   + `ui/`). Boxes align, colour is consistent, nothing looks bolted on.
2. **Real data, our sources.** Wire to the live Circuit ecosystem — never mock.
   Inference, price-feed, circuit-node and Solana are all reachable today.
3. **Layered & honest.** `services` talk, `ui` draws, `modules` glue. A feature
   never reaches across layers. Read paths are tested live; write paths (send /
   swap / paid inference) are gated behind explicit confirmation.
4. **Works two ways.** `circuit` opens the interactive console; `circuit <verb>`
   scripts a single action (with `--json` for machines).

## 2. Architecture

```
src/
├─ index.js              dispatch: interactive (no args) vs commander (verbs)
├─ config.js             static config + user config (~/.circuit/config.json)
├─ core/
│  ├─ context.js         build once: { config, services, status } shared ctx
│  ├─ registry.js        THE module list — drives both menu and commands
│  └─ menu.js            interactive menu loop
├─ services/             ← ecosystem clients. data in/out, ZERO console output
│  ├─ http.js            fetch wrapper (timeout, json, typed errors)
│  ├─ solana.js          Connection, keypair load, CIRC/Token-2022 constants
│  ├─ wallet.js          SOL + CIRC balance, transfer, x402 payment, swap quote
│  ├─ x402.js            generic pay-and-retry; parse 402 payment requirements
│  ├─ inference.js       chat (stream + once) through the x402 gateway
│  ├─ priceFeed.js       :18941 — prices, candles, active, slippage, token
│  ├─ circuitNode.js     :18940 — network, swarm/*, trending
│  └─ node.js            join installer, payouts (best-effort)
├─ ui/                   ← presentation. pure render, ZERO domain logic
│  ├─ banner.js  layout.js  components.js  screen.js  chart.js  prompts.js
├─ modules/              ← features = services + ui. each owns screen + commands
│  ├─ chat  wallet  data  swarm  network  node  status  about
└─ util/  format.js (money/num/pct/time/mint), keys, async
```

**Adding a feature** = one `services` method + one `modules` screen + a line in
`registry.js`. Menu and verbs both read the registry, so they never drift.

## 3. Live endpoints (grounded — probed 2026-06-25)

| Source | Base | Auth | Status |
| --- | --- | --- | --- |
| Inference (DLLM) | `inference.circuitllm.xyz/v1` | **x402** (CIRC) | ✅ public — `/models` open, `/chat/completions` → 402 |
| Node onboarding | `circuitllm.xyz/join` | none | ✅ public installer |
| x402 data gateway | `api.circuitllm.xyz` | x402 | ✅ public (`/health`, `/api/quote`, `/api/status`) |
| circuit-node swarm | `api.circuitllm.xyz/api/swarm/*` | none | ✅ public — read-only, GET-only, rate-limited (nginx → `:18940`) |
| circuit-node data | `:18940` (local) | x402 off-host | 🟢 `/api/network`, `/api/trending` free on the VPS; **x402-gated for non-localhost** (intentionally monetized) |
| price-feed | `:18941` (local) | none | 🟢 `/prices /candles /active /slippage /token` |
| Solana | public RPC + config override | none | ✅ balances, transfers, swap |

**x402 inference flow** (the one paid path):
`POST /chat/completions` → `402 { payment: { recipient, amountRaw (≈401 CIRC ≈ $0.03), token: CIRC, tokenProgram: Token-2022 } }` → transfer CIRC to recipient → retry with `X-Payment-Signature: <txSig>`. (Ported from circuit-agent's production `chatCompletion`.)

## 4. Modules

Legend: **C** = command, **S** = interactive screen. Readiness: ✅ ship now · 🟢 VPS-local · 🔶 needs backend.

### chat — talk to the decentralized 72B  ✅
- `circuit chat ["prompt"]` one-shot/stream · pipe stdin · interactive REPL (S)
- Flags `--model --temp --system --max-tokens --json --models`
- **Live CIRC cost meter** per request (amount, USD, payment txSig)
- Services: `inference`, `wallet` (x402)

### wallet — the CIRC you pay with  ✅ read / gated write
- `circuit wallet` balances + portfolio (S) · `receive` (address + ASCII QR)
- `send <to> <amount> [--token circ|sol]` (confirm-gated) · `swap` quote→confirm (Jupiter)
- `history` recent activity · Services: `wallet`, `solana`, `priceFeed`

### data — on-chain intelligence  ✅/🟢
- `token <mint>` price/liq/mcap (S) · `price <mint>` · `chart <mint>` braille candles
- `trending` · `dips` · `pool <addr>` · `slippage <mint> <sizeSol>`
- Services: `priceFeed`, `circuitNode`

### swarm — the autonomous traders  🟢 (live: 21 agents, 1.4k signals)
- `swarm` overview (S) · `leaderboard` · `feed` live signal ticker · `holdings`
- Services: `circuitNode` (`/api/swarm/*`)

### network — chain + mesh health  🟢/🔶
- `network` Solana TPS/slot + inference gateway ping + mesh status (S) · `watch` live
- Services: `circuitNode` (`/api/network`), `inference` (ping), `node`

### node — contribute & earn  ✅ join / 🔶 earnings
- `node join` run/print the one-line installer · onboarding wizard
- `node earnings` payout history (best-effort) · Services: `node`

### status — cross-cutting  ✅
- `status` one-glance dashboard (mesh, model, CIRC price, wallet, swarm) ·
  `doctor` connectivity check to every service

### about — ecosystem overview  ✅ (done)

## 5. Config & security

- User config at `~/.circuit/config.json`: `{ rpcUrl, defaultModel, walletPath, output }`.
- Wallet keypair at `~/.circuit/id.json` (Solana byte-array format) **or** env
  `CIRCUIT_WALLET` (base58). Read paths work with just an address (`--address`).
- **No secret is ever printed or logged.** Write actions (`send`, `swap`, paid
  `chat`) always show what will happen and require explicit confirmation; `--yes`
  opts out for scripting.

## 6. Build phases

1. **Foundation** — deps, config loader, `util/format`, `ui/` (layout, components,
   screen, chart, prompts), keep `theme` + `banner`.
2. **Services** — http, solana, wallet, x402, inference, priceFeed, circuitNode, node.
3. **Modules** — about, data, swarm, network, status, node, wallet, chat + registry/menu.
4. **Wire** — `index.js` dispatch; commander verbs from the registry.
5. **Verify** — live test read paths + chat 402 handshake; commit & push.

## 7. Non-goals (for now)

Encrypted-at-rest keystore, multi-account profiles, agent scaffolding
(`init agent`), full TUI watch dashboards, mesh routing visualisation — all
land after the core console is solid.

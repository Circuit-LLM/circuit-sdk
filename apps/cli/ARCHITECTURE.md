# Architecture

circuit-cli is a small, layered Node (ESM) application. One rule keeps it simple as it grows:

> **`services` talk. `ui` draws. `modules` glue.**

A feature never reaches across a layer. A service never prints; a UI helper never makes a network call; a module orchestrates the two. Get that right and everything else follows.

---

## Map

```
src/
├─ index.js                 dispatch: interactive (no args) vs commander (verbs)
├─ config.js                static config + user config (~/.circuit/config.json)
├─ core/
│  ├─ context.js            build once: { config, status } shared context
│  ├─ registry.js           THE module list — drives the menu AND the verbs
│  ├─ menu.js               interactive menu loop
│  ├─ splash.js             first-load screen (banner + mesh probe + panel)
│  └─ render.js             screenFrame() — clear, header, draw, wait
├─ services/                ← talk to the ecosystem. data in/out, ZERO console output
│  ├─ http.js               fetch wrapper (timeout, json, typed errors)
│  ├─ solana.js             connection, keypair load, keystore, RPC fallback
│  ├─ wallet.js             SOL + CIRC balances, transfers, Jupiter swap
│  ├─ x402.js               the shared pay-and-retry flow
│  ├─ inference.js          DLLM chat (stream + once) through the x402 gateway
│  ├─ priceFeed.js          prices, candles, active, slippage, token
│  ├─ circuitNode.js        network, swarm/*, trending, dex
│  └─ node.js               GPU join installer
├─ ui/                      ← draw. pure render, ZERO domain logic
│  ├─ banner.js  layout.js  components.js  screen.js  chart.js  prompts.js
│  └─ index.js              barrel — one import surface for the UI
├─ modules/                 ← features = services + ui. each owns screen + verbs
│  ├─ chat  wallet  data  swarm  network  node  status  about
└─ util/  format.js
```

---

## Layers

### services/ — the network boundary

Each service is a thin client over one part of the ecosystem. They return plain data or throw a typed error (`HttpError`, `PaymentRequiredError`). They do **not** format output or touch the terminal — that keeps them reusable across the interactive screens, the command verbs, and any future automation.

- **http.js** — `getJson` / `postJson` / `fetchT` with timeouts and `HttpError`.
- **solana.js** — the `Connection`, keypair loading (`CIRCUIT_WALLET` → `~/.circuit/id.json`), the keystore (`saveKeypair`, `generateKeypair`, `keypairFromInput`), and `withRpc()` — a fallback that advances across RPC providers on a `429` or a stall.
- **wallet.js** — `makeWallet()` returns balances (`solBalance`, `circBalance`), transfers (`sendCirc`, `sendSol`), and `swap` / `swapQuote` (Jupiter). All routed through `withRpc`.
- **x402.js** — `withX402(requestFn, wallet)` performs the request, and on `402` parses the payment requirement, pays CIRC, and retries with `X-Payment-Signature`.
- **inference.js** — `chat` / `chatStream` build the request and run it through the x402 flow; `chatStream` parses the SSE token stream.
- **priceFeed.js / circuitNode.js / node.js** — read clients for market data, the swarm registry, network stats, and the GPU installer.

### ui/ — the presentation boundary

Pure functions from data to styled strings. No service is imported here. `src/theme.js` holds the design tokens (palette, the brand gradient, glyphs); everything visual is derived from it.

- **banner.js** — the gradient `CIRCUIT` wordmark (figlet + per-line gradient), centred, with a compact fallback.
- **layout.js** — `center`, `centerBlock`, `splitLine`, `divider`, ANSI-aware `width`.
- **components.js** — `panel` (rounded box), `badge`, `statusDot`, `kv`, `table`, `heading`.
- **chart.js** — `sparkline` and a `brailleChart` line chart from a series of values.
- **screen.js** — `slimHeader`, `compactBrand`, `pressKey` (raw-TTY, resolves instantly when not a TTY).
- **prompts.js** — thin wrappers over `@clack/prompts` (`menuSelect`, `askText`, `askConfirm`, `askPassword`) and a `spinner`, with consistent cancellation.

### modules/ — the features

Each module is one object: `{ id, icon, name, desc, screen, register? }`.

- `screen(ctx, opts)` renders the interactive view (used by the menu).
- `register(cmd, ctx)` attaches command verbs and options to the module's base command.

Modules import from `services/` and `ui/` and glue them together — fetch with a service, render with the UI, gate writes behind a confirm.

### core/ — the wiring

- **registry.js** lists the modules. `registerCommands()` builds `circuit <id>` for each (default action = its `screen`) and lets the module add sub-verbs. The menu reads the same list. **One source, no drift.**
- **context.js** builds the shared `{ config, status }`.
- **splash.js / menu.js / render.js** are the interactive shell.

---

## Dispatch

`bin/circuit.js → src/index.js run()`:

- **No arguments** → interactive: `splash()` (banner + a live mesh probe) → `mainMenu()`.
- **A verb** → `commander` parses it and runs the module's action directly. `--help` / `--version` resolve with no network calls.

The interactive screens show a status header; the standalone command screens show a compact wordmark. Both are pipe-safe — `pressKey` returns immediately when stdout isn't a TTY, so scripted runs never hang.

---

## A request: paid chat (x402)

```
circuit chat "hi"
        │
        ├─ modules/chat ── builds messages (+ system prompt)
        │        │
        │        └─ services/inference.chatStream(messages, wallet)
        │                 │
        │                 ├─ POST /v1/chat/completions  ──►  402 { payment }
        │                 ├─ services/wallet.sendCirc(treasury, amount)  ──►  txSig
        │                 ├─ POST … with X-Payment-Signature: txSig  ──►  200 (SSE)
        │                 └─ stream tokens ──► onToken()
        │
        └─ render the stream + a cost meter (CIRC, USD, tx)
```

The wallet transfer goes through `withRpc`, so a capped RPC transparently falls back to a public one mid-payment.

---

## Adding a feature

1. Add a method to the right **service** (or a new service file).
2. Add a **module** that fetches with it and renders with `ui/`.
3. Add one line to **`core/registry.js`**.

That line wires the feature into the menu and the CLI verbs at once. See [CONTRIBUTING.md](CONTRIBUTING.md) for a worked example.

---

## Design system

`src/theme.js` is the single re-skin point — palette, the `gold → yellow → bright` brand gradient (warm gold, matching the Circuit dashboards), semantic colours, and the glyph set. One constraint: **every glyph must be width-1** (a width-2 glyph like `⚡` desyncs `boxen`'s border math). New glyphs are checked against `string-width`.

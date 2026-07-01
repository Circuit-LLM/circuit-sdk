# Circuit SDK — Specification

**Status:** IMPLEMENTED / v0. 12 `@circuit/*` packages + the `circuit` CLI (in `apps/cli`, consuming the SDK) + a Python consume client; 164 TS tests green, typecheck + dist build clean. This spec describes the shipped code and stays the contract we build against.
**Repo:** `Circuit-LLM/circuit-sdk` (private).
**One line:** the developer toolkit for building on the Circuit ecosystem — **x402-paid decentralized
inference, data, and wallet ops**, and **hosted autonomous agents with off-box (non-custodial)
signing** — all settled per-call in CIRC.

This spec is grounded in the code that already exists (`circuit-cli`, `circuit-agent-cloud`,
`circuit-data-api`, `circuit-dllm`, `circuit-node-client`); most "consume" primitives are an
*extraction*, and the Agent SDK is the main *new build*. Real endpoints are in Appendix A.

---

## 0. TL;DR

- The SDK is **layered over Circuit's primitives**, not one library. The spine is **x402 pay-per-call**;
  on top sit **inference**, **data**, **wallet**; the **agent runtime** is the **Agent SDK**.
- "Agents *or* everything?" is a false choice: **an agent composes everything** — it *thinks*
  (inference), *senses* (data), *acts* (custody), and *lives* somewhere (hosting), each action paid in
  CIRC. Lead with agents; ship the consume layer first because it's nearly free to extract.
- **TypeScript-first** monorepo of `@circuit/*` packages + a thin **Python** consume client.
- Differentiators a developer can't get elsewhere: **no API keys (a wallet is the account)**,
  **decentralized contributor-owned 72B inference**, and **agents whose funds can't be stolen even on
  stranger hardware** (off-box signer + buy/sell-only policy + at-most-one epoch fence).

---

## 1. Vision & positioning

Circuit is a network of **monetized, decentralized capabilities**. The SDK's job is to let a developer
use and build on them without touching the plumbing (x402 handshakes, mesh routing, custody, on-chain
calls). The pitch:

> **Build autonomous agents that think, sense, and act on decentralized infrastructure — paid in CIRC,
> with funds that can't be stolen.**

What makes that non-generic (vs. "OpenAI + a VPS + a hot wallet"):
1. **x402 everywhere** — every paid call is a per-call CIRC micropayment. No accounts, no API keys, no
   subscriptions. A Solana wallet *is* the identity and the meter.
2. **Decentralized inference** — a contributor-owned 72B mesh (`circuit-dllm`), not a single vendor.
3. **Non-custodial hosted agents** — your strategy runs on someone else's CPU, but the signing key is
   off-box; a host can never drain the wallet (`buy`/`sell`-only). With **Verified Intents** (`@circuit/attest`)
   the signer re-runs your committed rule on authenticated inputs and signs only the matching trade, so a
   host can't forge a trade either — for checkable strategies, on any CPU. Opaque strategies use a TEE
   (Sealed Agents) or caps + deterrence.
4. **Earn by contributing** — the same SDK that consumes can also *join* the mesh (GPU/CPU) and be paid.

## 2. Audiences

| Audience | Wants to… | SDK surface |
|---|---|---|
| **Consumer** | call inference, buy data, pay with x402 from an app/script | `@circuit/inference`, `@circuit/data`, `@circuit/wallet`, `@circuit/x402` (+ `circuit-py`) |
| **Agent builder** | write an autonomous agent and host it on Circuit | `@circuit/agent` (base class, custody, lifecycle, mock, scaffold) |
| **Contributor** | run a GPU/CPU node, earn CIRC | `@circuit/node`, `@circuit/onchain` |

The SDK serves all three, but the **agent builder** is the headline persona because that's where every
primitive composes and where Circuit is most differentiated.

## 3. Architecture — the monorepo

A pnpm/npm-workspaces TypeScript monorepo. Dependency graph (arrows = "depends on"):

```
                         @circuit/core  ──────────────┐  (http · config/DI · ed25519 identity · types)
                            ▲     ▲                     │
              ┌─────────────┘     └──────────┐         │
        @circuit/x402            @circuit/wallet        │   (x402 = the payment spine; wallet = SOL/CIRC + swap)
          ▲   ▲   ▲                  ▲                  │
   ┌──────┘   │   └────────┐         │                  │
@circuit/   @circuit/   @circuit/    │                  │
inference     data      onchain      │                  │
   ▲           ▲          ▲          │                  │
   └─────┬─────┴────┬─────┘          │                  │
         │          │                │                  │
     @circuit/agent ─────────────────┘                  │   (AGENT RUNTIME: composes inference+data+custody+wallet)
         ▲                                               │
   @circuit/node ──────────────────────────────────────┘   (contributor: join the mesh, serve, earn)

   @circuit/sdk  = meta-package re-exporting the above
   circuit-py    = Python consume client (inference + data + x402 only)
```

Rule of thumb: **everything paid depends on `@circuit/x402`; everything depends on `@circuit/core`.**

## 4. The packages

Each package below lists **purpose · key API · source today · status**. Status legend:
**EXTRACT** (logic exists in `circuit-cli`/others, needs DI cleanup) · **BUILD** (new) · **WRAP** (thin
client over an existing HTTP service).

### 4.1 `@circuit/x402` — the payment spine  ·  status: EXTRACT (the one must-do)

The generic "402 → build payment → retry with proof" flow. Today it's **duplicated** (a client-side
`withX402()` in `circuit-cli/src/services/x402.js`, and a server-side verifier in
`circuit-data-api/middleware/x402.js`). The SDK unifies the **client** half and re-exports the verify
half for service authors.

```ts
import { X402Client } from '@circuit/x402';

const x402 = new X402Client({ wallet, token: 'CIRC' });   // wallet from @circuit/wallet
// Wrap ANY request; on 402 it pays the quoted CIRC and retries with X-Payment-Signature.
const res = await x402.fetch('https://inference.circuitllm.xyz/v1/chat/completions', {
  method: 'POST', body: JSON.stringify(req),
  onPay: (q) => log(`paying ${q.amountDisplay} for ${q.path}`),   // optional approval hook
});
```

- **Client:** `X402Client.fetch(url, opts)` — generic, streaming-aware (don't buffer SSE);
  `PaymentRequiredError` when no wallet is loaded; one free retry on 429/5xx; **payment approval hook**
  + a spend cap so an app can't be drained by a misquoting server.
- **Server helpers (for service authors):** `createX402Middleware(endpointConfig)`,
  `verifyPaymentTx`, `calcRequiredCirc`, `getCircUsdPrice`, `formatCirc` — ported from the data-api
  middleware so new paid services reuse one implementation.
- **Constants:** CIRC mint `8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump` (Token-2022), treasury,
  6 decimals, 5-min tx TTL, single-use replay guard.

### 4.2 `@circuit/core` — http · config · identity · owner-auth · types  ·  status: ✅ BUILT

The shared base. **The main change vs. circuit-cli is dependency injection** — no hardcoded
`~/.circuit/` paths or singleton config; everything is constructor-injectable so the library embeds.
Also home to **`owner-auth`** — per-owner control-plane request signing (`ownerAuthHeaders` /
`verifyOwnerRequest` / `NonceStore`), byte-identical to `circuit-agent-cloud` (golden-vector locked), so
the CLI + cloud share one signing contract.

- `http`: `getJson`, `postJson`, `fetchT`, `HttpError` (from `circuit-cli/services/http.js`).
- `config`: a `CircuitConfig` object (endpoints, RPC URL, mints, model ids) — injectable, with env +
  file (`~/.circuit/config.json`) loaders as *optional* helpers, not hard dependencies.
- `identity`: ed25519 keypair gen + request signing (`X-Node-Id`/`X-Node-Signature`/`X-Node-Timestamp`),
  ported from `circuit-node-client/lib/identity.js`. Distinct from the *payment* wallet.
- `types`: shared TS types (re-exported by every package).

### 4.3 `@circuit/inference` — decentralized LLM  ·  status: EXTRACT/WRAP

OpenAI-compatible client for the DLLM mesh, x402-aware.

```ts
import { Inference } from '@circuit/inference';
const ai = new Inference({ x402 });   // pays per call automatically
const out = await ai.chat({ messages, max_tokens: 256 });
for await (const delta of ai.chatStream({ messages })) process.stdout.write(delta);
const models = await ai.listModels();
```

- Wraps `POST /v1/chat/completions` (SSE streaming via `data: {…}` frames) + `GET /v1/models` +
  `/health` at `inference.circuitllm.xyz` (gateway). Supports `max_tokens`, `stream`, `tools`,
  `spec_k`, `tree`/`tree_nodes` (speculative/tree drafting). `X-Internal-Key` bypass honored for
  trusted/co-located callers. Source: `circuit-cli/services/inference.js` + `circuit-dllm` engine API.

### 4.4 `@circuit/data` — market & on-chain data  ·  status: WRAP

Typed client for `circuit-data-api`'s 21+ paid endpoints + the free ones.

```ts
import { Data } from '@circuit/data';
const data = new Data({ x402 });
await data.tokenPrice(mint);            // $0.001   ORACLE
await data.walletAnalytics(addr);       // $0.01    WALLET
await data.marketOverview();            // $0.002
await data.tokenSecurity(mint);         // $0.005
const quote = await data.quote();       // FREE — live pricing for every endpoint
```

- Categories: token (price/info/ohlcv/holders/security/trending/top-traders), wallet (analytics/pnl),
  market (overview/sentiment/new-tokens), defi (overview/yields/staking), chain (network-stats/news/
  validators/bridge), pools, nft, scan. Free: `quote`, `prices`, `status`, `probe`, swarm reads.
- Each paid method routes through `@circuit/x402`. Types generated from the endpoint catalog.

### 4.5 `@circuit/wallet` — SOL/CIRC + swaps  ·  status: DONE

```ts
import { makeWallet } from '@circuit/wallet';
const w = makeWallet({ keypair, rpcUrl });
await w.solBalance(); await w.circBalance();
await w.sendCirc(to, amountRaw); await w.sendSol(to, lamports);
await w.swap({ inMint, outMint, amount });   // Jupiter Ultra
```

Stateless factory ported from `circuit-cli/services/{wallet,solana}.js` (CIRC is Token-2022). Used by
`@circuit/x402` to fund payments and by `@circuit/agent` for owner-side ops. **`walletTradeExecutor(w)`**
turns a keyed wallet into a self-custody `TradeExecutor` for `@circuit/agent`'s `LocalKeypairCustody`
(buy = swap SOL→token, sell = swap token→SOL, signed locally) — so an agent on hardware you control
trades with its own key, while on the mesh signing stays off-box.

### 4.6 `@circuit/agent` — the agent runtime  ·  status: DONE

Today an agent on `circuit-agent-cloud` must hand-wire the signer HTTP client, the session-token/epoch
fence, `heartbeat.json`, log routing, and SIGTERM checkpointing (see `agentd/agentd.js`). The SDK
collapses that to a **base class** where the developer writes only strategy.

```ts
import { CircuitAgent } from '@circuit/agent';

class DipBot extends CircuitAgent {
  async setup()  { this.cfg = this.readConfig(); this.ai = this.inference(); this.data = this.data(); }
  async tick()   {                                   // called in a loop by the runtime
    const picks = await this.data.tokenTrending();
    const call  = await this.ai.chat({ messages: prompt(picks) });   // think
    const sig   = decide(call);
    if (sig.buy) await this.buy(sig.mint, sig.sizeSol);              // act — via the selected custody
  }
  async onDrain(){ await this.checkpoint(); }        // node budget cut / reschedule
}
new DipBot().run();                                  // runtime owns the rest
```

The base class **owns**:
- **Custody** — `buy(mint,sizeSol)` / `sell(mint,amount)` go through a `Custody` chosen by environment;
  all four modes share one `PolicyEngine` gate + rejection codes, so strategy code is identical across
  them: **`SignerCustody`** (off-box signer — `CIRCUIT_SIGNER_URL` + epoch/session, the mesh default),
  **`LocalKeypairCustody`** (self-custody — pass `executor: walletTradeExecutor(wallet)`; signs locally
  on a box you control), **`VaultCustody`** (non-custodial on-chain vault), **`MockCustody`** (paper).
  Selection order: explicit `custody` → `signerUrl` → `executor` → paper. Rejections (`fenced` /
  `cooldown` / `over-trade-cap` / `token-denied`) are handled uniformly.
- **Lifecycle** — `setup() → tick()` loop → `onDrain()`/SIGTERM → `checkpoint()` → clean exit(0).
- **Heartbeat** — periodic `heartbeat.json` (state, uptime, pnl, positions, signedTrades) the host
  forwards to the control-plane.
- **Logs** — `this.log()` → stdout + `agent.log` (tailed by the host).
- **Composition helpers** — `this.inference()` / `this.data()` pre-wired to `@circuit/inference` /
  `@circuit/data` so an agent thinks + senses out of the box.

Plus, critically:
- **Verified-intent mode** — pass a committed `rule` + the producer keys you trust and call
  `verifiedTrade(inputs, evidence)`: the agent evaluates the rule locally and submits
  `{ intent, rule, inputs, evidence }`, which the off-box signer re-derives before signing (so a hostile
  host can't forge a trade). Built on `@circuit/attest` (§4.7); guide in `docs/verified-intents.md`.
- **Run anywhere, unchanged** — the same agent paper-trades locally with no signer (`MockCustody`),
  trades live self-custody on your own box (`new DipBot({ executor: walletTradeExecutor(wallet) })` →
  `LocalKeypairCustody`; live when `CIRCUIT_AGENT_PAPER=0`), or runs off-box on the mesh — all through
  the *same decision gate*, so dev == prod.
- **Scaffold** — `npx circuit-agent new my-bot` → a typed starter project (strategy stub, config
  schema, local-run script, deploy notes).
- **Types** — `AgentOptions`, `AgentContext`, `Intent` / `IntentResult`, `Policy` (`maxNotionalSol`,
  `maxDailySol`, `cooldownMs`, `allow:['buy','sell']`, `denyTokens`, `allowTokens`, `paper`), `Position`,
  `Heartbeat`, plus the custody surface: `Custody` / `SignerCustody` / `LocalKeypairCustody` /
  `VaultCustody` / `MockCustody` / `ExecutorCustody` + `TradeExecutor` (`VaultTradeExecutor` = deprecated
  alias) + `AgentOptions.executor`.

**Scope note:** the *hosting* layer (control-plane placement, node-host, failover) is general-purpose
CPU compute — custody (buy/sell) is the trading-specific add-on. So `@circuit/agent` supports **two
shapes**: (a) **trading agents** (with custody), (b) **general agents** (no custody — just hosted
compute + inference + data). The base class makes custody opt-in.

> Deployment (`create/start/stop/destroy`, placement, the operator's node-host) lives in the `circuit`
> CLI (now `apps/cli` in this monorepo) / `circuit-agent-cloud`; `@circuit/agent` is what you *write the
> agent with*. A future
> `@circuit/agent-cloud` client can wrap the control-plane management API if devs want to deploy
> programmatically.

### 4.7 `@circuit/attest` — verified intents  ·  status: BUILT

The trust keystone for hosted agents (`docs/verified-intents.md`). Zero deps beyond `@circuit/core`:

- **sign/verify** — canonical Ed25519 over `stableStringify` (raw-hex keys); the same scheme the
  data-API and inference gateway sign responses with, and the off-box signer verifies.
- **evidence** — `SignedQuote` (first-party data), `InferenceReceipt` (signed AI verdict), `ZkTlsProof`
  (third-party); `verifyEvidence` checks signature + freshness + replay against trusted keys/notaries.
- **rule DSL + evaluator** — `Rule = { id, when[], then, requires[] }`; `evaluateRule(rule, inputs)` is a
  pure function returning the `Intent` or `null` — the *same* function the signer re-runs.
- **decision gate** — `decisionGate(verifiedIntent, opts)`: verify evidence → bind inputs → re-run rule →
  must equal the intent, else reject (`decision-unjustified` / `evidence-*` / `input-mismatch`).

`@circuit/agent` consumes it for `verifiedTrade`; `@circuit/data`/`@circuit/inference` consume it to
verify signed responses; `circuit-agent-cloud`'s signer ships a byte-identical plain-JS port that enforces
the gate before signing. The property — *a host can't get a trade signed that the rule + authenticated
inputs don't justify* — is proven by the gate test suite.

### 4.8 `@circuit/node` — contributor side  ·  status: EXTRACT (partial)

Programmatically join/manage a mesh node. Ports the reusable bits of `circuit-node-client`:
`announce`/`ping`/`deregister` (`lib/registry.js`), identity signing, `sync` (poll+cache), and the
mesh control-plane `/register · /ready · /heartbeat · /drain · /topology` protocol
(`circuit-dllm/engine/control_server.py`). The heavy GPU orchestration (llm-worker, layer serving)
stays in the node client/image; the SDK exposes the *control* surface for "spin up / manage a node from
code."

### 4.9 `@circuit/onchain` — CIRC · StakePoint · mesh_registry  ·  status: ✅ BUILT

Pure-RPC reads (the project's convention — `getProgramAccounts` + memcmp + discriminator), ported from
`circuit-node-client/lib/stakepoint.js`: `verifyStake(wallet, pool, minAmount)`, `getStakePositions`,
CIRC balance helpers, and readers for the on-chain control-plane `mesh_registry` Anchor program
(devnet `BC2sxffu…`): `getMeshConfig()` (topology/authority/auditor/version), `getNodes()` and
`getNode(pubkey)` (each node's role/trust/ban/payout/stake-pool, decoded from the 124-byte account).
No heavy Anchor client on the read path.

### 4.10 `@circuit/sdk` — meta-package  ·  status: ✅ BUILT

Re-exports the consume + agent + contributor packages so `import { Inference, Data, CircuitAgent } from
'@circuit/sdk'` works for the batteries-included case. `@circuit/bundle` (publishing) and `@circuit/vault`
(on-chain, pulls Anchor) are intentionally **not** re-exported here — import them directly so the meta
package stays lean and web3-free.

### 4.11 `circuit-py` — Python consume client  ·  status: ✅ BUILT (`circuit-py/`)

A thin Python package for the consume side only (**inference + data + x402**), where data/ML consumers
live. Mirrors the TS client surface; not a full port (no agent runtime, no wallet ops beyond paying).

### 4.12 `@circuit/bundle` — agent bundles  ·  status: ✅ BUILT

The canonical codec for **content-addressed, signed agent bundles**: `createBundle` (pack a dir → gzipped
tarball, hash, sign the manifest), `verifyBundle` (sha256 + Ed25519 sig + owner-binding + safe-entry
checks before any byte runs), `packDir`/`unpackTo`, and the Ed25519/base58/sha256 primitives. The manifest
signing bytes are a **cross-implementation contract** with `circuit-agent-cloud/lib/bundle.js` and
`circuit-cli/src/services/bundle.js`; a golden test vector pins byte-identity so the three impls can't
drift. Zero runtime deps (Node crypto + system `tar`). Follow-on: point the cloud + CLI at this package
as the single source to retire the duplicate copies.

### 4.13 `@circuit/vault` — non-custodial vault client  ·  status: ✅ BUILT (opt-in)

The off-chain client for the **circuit-agent-vault** Anchor program (devnet `9AmhsDD9…`): `VaultClient`
mirrors every instruction (init/deposit/withdraw/setDelegate/updateConfig/setRoutes/setRule/close/
wrap/unwrap), `trade()` is the **route-agnostic swap adapter** (wraps ANY DEX instruction as a guarded
vault CPI), `jupiterSwapInstruction` is the production route source, and **`makeVaultExecutor`** is the
concrete executor that plugs into `@circuit/agent`'s `VaultCustody` (paper=false) to land real on-chain
trades signed by the trade-only delegate. **Opt-in:** it pulls `@anchor-lang/core` (a peer dependency),
so the lean core stays web3-free — install it only when you want on-chain vault custody. The IDL is
vendored from the vault repo's `anchor build`; this is the canonical home (the `circuit-agent-vault/client/`
copy becomes a re-export — tracked follow-on).

## 5. Cross-cutting

- **Config / DI:** one injectable `CircuitConfig`; env + file loaders are optional helpers. No global
  singletons, no hardcoded paths — the #1 refactor from circuit-cli's services.
- **Two key types, kept distinct:** the **payment wallet** (Solana keypair, pays x402) vs. the **node
  identity** (ed25519, signs registration). An app needs only the former; a contributor needs both; an
  agent needs *neither at runtime* (the off-box signer holds its key).
- **Errors:** typed and catchable — `PaymentRequiredError`, `HttpError`, `FenceError`,
  `PolicyRejected`, `InsufficientFunds`. Each carries the machine code (`fenced`, `over-trade-cap`, …).
- **Streaming:** SSE (`text/event-stream`, `data: {…}\n\n`) — the client exposes async iterators, never
  buffers a stream to pay.
- **Testing:** pure functions + injected wallet/config make units mockable; `MockCustody` + a mock
  control-plane/signer give agents an end-to-end local harness before any cloud deploy.

## 6. Packaging, build, release

- **Monorepo:** npm/pnpm workspaces, `packages/*`. TypeScript, ESM-first (matches `circuit-cli`).
  Shared `tsconfig.base.json`; each package builds to `dist/` (esm + d.ts) via **tsup** (✅ built).
  **Dual-mode exports:** the `development` condition resolves cross-package imports to `src/*.ts` for
  zero-build dev (Node 22 strip-types + tsc `customConditions`); the default condition serves the
  compiled `dist/*.js` to consumers. `prepack` rebuilds dist on publish. `@circuit/agent` ships a
  `circuit-agent` bin (`circuit-agent new <name>`). ✅
- **Versioning:** changesets; packages versioned independently, `@circuit/sdk` pins compatible ranges.
- **Publish:** private registry / GitHub Packages while closed; npm public at launch.
- **CI:** typecheck + unit tests per package; the agent harness runs against `MockCustody`.

## 7. Roadmap

| Phase | Ships | Why |
|---|---|---|
| **0 — spine** ✅ | `@circuit/x402` + `@circuit/core` | **DONE** — extracted, DI-cleaned, 44 tests green (see `packages/`) |
| **1 — consume SDK** ✅ | `@circuit/inference` + `@circuit/data` + `@circuit/wallet` + `@circuit/sdk` meta | **DONE** — extracted onto the spine; 75 tests green (`circuit-py` deferred) |
| **2 — agent runtime** ✅ | `@circuit/agent` (base class · four custody modes · scaffold) | **DONE** — `CircuitAgent` over custody-agnostic trading (paper · self-custody · off-box signer · vault); 104 tests green |
| **3 — contribute** ✅ | `@circuit/node` + `@circuit/onchain` | **DONE** — mesh control + node registry + StakePoint/CIRC reads; 130 tests green |
| **4 — extended** ✅ | `@circuit/bundle` + `@circuit/vault` + `@circuit/onchain` mesh_registry reader | **DONE** — content-addressed signed bundles (cross-impl golden vector), the non-custodial vault client + `makeVaultExecutor`, and on-chain control-plane reads; **164 TS tests green total**, typecheck + dist build clean |

**MVP (end of Phase 1):** `npm i @circuit/sdk`, load a wallet, call `inference.chat()` and
`data.tokenPrice()` with automatic CIRC payment — a working, documented quickstart.

## 8. Non-goals (for now) & open questions

- **Non-goals (for the `@circuit/*` libraries):** the interactive terminal UI and agent *deployment*
  orchestration — those live in the `circuit` CLI **app** (`apps/cli`), which now ships in this monorepo
  and consumes the libraries; and the GPU inference internals. A `@circuit/agent-cloud` deployment client
  can come later if warranted.
- **Open questions:** (1) USDC alongside CIRC for x402? (today CIRC-only.) (2) browser/edge build of
  `@circuit/inference` (wallet signing in-browser)? (3) general (non-trading) agent custody — is
  "compute-only, no signer" a first-class mode in v1? (4) full ALT program resolution before
  unsupervised live trading at size (a signer hardening, tracked in agent-cloud, not the SDK).

---

## Appendix A — grounded API reference (real surfaces today)

**Inference** (`inference.circuitllm.xyz`, gateway `circuit-data-api/inference-gateway.js` → engine):
`POST /v1/chat/completions` (x402; SSE when `stream:true`), body `{messages,max_tokens,stream,tools,
spec_k,tree,tree_nodes}`; free `GET /v1/models`, `GET /health`; bypass `X-Internal-Key`.

**Data** (`circuit-data-api`, ~21 paid + free): paid `POST/GET /api/{token-price,token-info,token-ohlcv,
token-holders,wallet-analytics,wallet-pnl,market-overview,market-sentiment,new-tokens,defi-overview,
yields,staking-yields,network-stats,news,validators,bridge-activity,nft-overview,top-pools,
token-security,token-top-traders,token-trending,scan}` ($0.001–$0.015); free `GET /api/{quote,prices,
oracle-prices,status,probe,agents,swarm/*}`, `GET /health`.

**x402** (`circuit-data-api/middleware/x402.js`): `402` with CIRC quote → pay treasury → retry with
`X-Payment-Signature: <txSig>`; verify on-chain (Token-2022 transfer to treasury, ≤5-min age,
single-use). CIRC mint `8fQg…pump`, 6 decimals.

**Agent custody** (`circuit-agent-cloud/signer`, :18981): runtime API an agent calls =
`POST /v1/agents/{id}/intent` `{epoch, token, intent:{kind:'buy'|'sell', token, sizeSol, amount,
maxSlippageBps}}` → `{ok, code:'signed'|'submitted'|'fenced'|'over-trade-cap'|…, signature, txid,
daySpentSol}`. Wallet is off-box (AES-256-GCM sealed); session = `{epoch (monotonic), token}` issued by
the control-plane per placement; epoch fence rejects orphaned sessions.

**Agent contract** (`circuit-agent-cloud/agentd/agentd.js`): env `CIRCUIT_AGENT_DATA_DIR/ID/EPOCH/
SESSION/ADDRESS`, `CIRCUIT_SIGNER_URL`, `CIRCUIT_AGENT_PAPER`; read `config.json`; write
`heartbeat.json` + `agent.log`; SIGTERM → checkpoint → exit(0).

**Mesh control plane** (`circuit-dllm/engine/control_server.py`, :18932): `POST /register · /ready ·
/heartbeat · /drain`, `GET /topology · /health`; optional ed25519 register-auth. **Node registry**
(`circuit-node-client/lib/registry.js`): `POST /api/network/nodes/announce · /ping`, `DELETE
/api/network/nodes/{id}`, `GET /api/network/nodes`.

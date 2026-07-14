# Architecture

How the SDK is built and why it is shaped the way it is: the design principles, the monorepo layout,
the dependency graph, the zero-build development flow, and how it compiles for publishing.

- [Design principles](#design-principles)
- [Monorepo layout](#monorepo-layout)
- [Dependency graph](#dependency-graph)
- [Zero-build dev, compiled publishing](#zero-build-dev-compiled-publishing)
- [Build & publish](#build--publish)
- [Testing](#testing)
- [Two identity schemes](#two-identity-schemes)
- [Conventions](#conventions)

---

## Design principles

A few decisions shape everything else:

- **x402 is the spine.** Every paid capability settles the same way: a `402 Payment Required` answered
  with an on-chain CIRC micropayment, then a retry. There is one payment path and no API keys, and
  everything that costs money depends on `@circuit-llm/x402`.
- **Everything depends on a tiny core.** `@circuit-llm/core` (HTTP, config, ed25519 identity, owner-auth,
  shared types) has zero runtime dependencies, and so do `@circuit-llm/x402` and `@circuit-llm/bundle`. Only
  `@circuit-llm/wallet` (Solana) and the opt-in `@circuit-llm/vault` (Anchor) pull anything heavy, so a consumer
  who only wants inference and data installs neither.
- **Dependency injection over singletons.** No global config, no hardcoded paths. Every effectful
  boundary, fetch, RPC, filesystem, clock, and wallet, is injectable. That is what lets the whole suite
  run offline in tests and lets the library embed anywhere.
- **Custody is one interface, four backends.** An agent sends an intent; where the signing key lives,
  paper, self-custody, off-box signer, or on-chain vault, is a swap of the backend, not a rewrite of the
  strategy. The same agent code runs from a paper bot on a laptop to a non-custodial vault agent on
  borrowed hardware.
- **Extracted from production, not reinvented.** The consume clients, the x402 flow, the custody
  contract, and the mesh protocol are taken from the systems Circuit already runs, so the SDK is faithful
  to what the network actually speaks.

---

## Monorepo layout

```
circuit-sdk/
  packages/
    x402/        the payment spine (402 → pay CIRC → retry · verify)     ← zero deps
    core/        http · config (DI) · ed25519 identity · owner-auth · types   ← zero deps
    inference/   OpenAI-compatible DLLM client
    data/        typed Circuit Data API client
    wallet/      SOL/CIRC ops + Jupiter swaps + RPC failover    (+ @solana/web3.js)
    models/      circuitllm.xyz/models gateway client (prepaid credits · OpenAI-compatible)
    agent/       CircuitAgent + off-box custody + scaffold + bin
    node/        mesh control plane + public registry clients
    onchain/     StakePoint stake + CIRC balance + mesh_registry reads (pure RPC)
    bundle/      content-addressed signed agent bundles               ← zero deps
    vault/       non-custodial on-chain vault client          (opt-in: @anchor-lang/core)
    sdk/         meta-package — re-exports the consume + agent + contributor packages
  apps/
    cli/         the `circuit` terminal console — built on the SDK (npm run cli)
    mcp/         the MCP server — data + swarm intel as x402-paid tools (npx @circuit-llm/mcp)
  circuit-py/    Python consume client (inference + data + x402)         ← stdlib only
  docs/          the documentation set (this file + guides + API reference)
```

npm workspaces (`packages/*` + `apps/*`). `circuit-py` sits outside the workspace (it's Python).

---

## Dependency graph

**x402 is the spine; everything paid depends on it. Everything depends on core.** The arrows are
"depends on":

```
        core ──────────────────────────────┐   (http · config · identity · types)
         ▲   ▲                               │
   ┌─────┘   └────────┐                      │
 x402            wallet (+solana)            │   (x402 = payment spine; wallet implements PaymentWallet)
  ▲  ▲  ▲              ▲                      │
  │  │  └──── onchain ─┘ (core only)          │
  │  └──── data ───┐                          │
  └──── inference ─┤                          │
                   ▼                          │
              agent ───────────────────────── ┘   (composes inference + data + custody)
                   ▲
              node (core only)

  sdk = meta (re-exports everything) · circuit-py = independent Python port
```

Three packages — **`@circuit-llm/x402`**, **`@circuit-llm/core`**, and **`@circuit-llm/bundle`** — have **zero
runtime dependencies**. `@circuit-llm/wallet` pulls Solana (`@solana/web3.js`, `@solana/spl-token`, `bs58`)
and the **opt-in** `@circuit-llm/vault` pulls Anchor (`@anchor-lang/core`); consumers who just want inference
+ data install neither.

---

## Zero-build dev, compiled publishing

The trick that keeps development build-free while shipping real JavaScript: **conditional exports** plus
**Node 22's native TypeScript type-stripping**.

Each package declares:

```jsonc
"exports": {
  ".": {
    "development": "./src/index.ts",   // dev / tests / typecheck resolve here
    "types": "./dist/index.d.ts",      // editors + consumers get the .d.ts
    "default": "./dist/index.js"       // published consumers run the compiled JS
  }
}
```

- **Development** — tests, typecheck, and cross-package imports resolve to `src/*.ts`. Node runs them
  directly with `--experimental-strip-types --conditions=development` (no transpile step); `tsc` resolves
  the same condition via `customConditions: ["development"]` in `tsconfig.base.json`. **No build needed
  to develop or test.**
- **Consumers** — without the `development` condition, imports resolve to the compiled `dist/*.js` + the
  `.d.ts`. A package A that imports B resolves B's `dist` too, so a published install is all JavaScript.

This is why `npm test` runs straight off TypeScript and a consumer still gets clean compiled output.

---

## Build & publish

```bash
npm run build      # each package: tsup src/index.ts → dist/index.js (ESM) + dist/index.d.ts
```

- **tsup** (esbuild) bundles each package's `src` into one ESM file, externalizing workspace deps and
  node builtins; a bundled `.d.ts` is emitted alongside.
- `@circuit-llm/agent` also builds its `bin/circuit-agent.ts` → `dist/circuit-agent.js` (shebang preserved),
  wired as the `circuit-agent` bin.
- `dist/` is git-ignored; `prepack` rebuilds it, so `npm publish --workspaces` always ships fresh JS +
  types. `files: ["dist"]` keeps the published tarball to compiled output only.

`circuit-py` builds with `hatchling` (`pyproject.toml`).

---

## Testing

```bash
npm test            # 196 TS tests across all packages, zero-transpile (node:test + strip-types)
npm run typecheck   # tsc --noEmit on all 14 packages (strict + noUncheckedIndexedAccess)
cd circuit-py && python3 -m unittest discover -s tests   # 12 Python tests
```

Tests use the stdlib `node:test` runner and inject fakes — a stub `fetch`, a fake `PaymentWallet`, an
in-memory filesystem, an injectable clock — so the entire suite runs **offline, with no network, no
Solana, and no real signer.** That's a deliberate design constraint: every client takes its transport,
wallet, connection, and clock as injectable dependencies.

---

## Two identity schemes

The SDK reproduces both ed25519 identities the ecosystem uses — they are **not** interchangeable:

| | `@circuit-llm/core` `Identity` | `@circuit-llm/node` `MeshIdentity` |
|---|---|---|
| Used by | the public node registry | the inference-mesh control plane |
| `nodeId` | SPKI/DER public key, base64 | raw public key, hex |
| Signing | `X-Node-*` headers; `canonicalPayload(nodeId, ts, body)` | `node_id`+`ts` in the body; `sig` over compact sorted-JSON of body-minus-sig |

Both match the live servers byte-for-byte (verified by round-trip tests against the real
`control_server.py` signer/verifier). See [contributing-a-node.md](./contributing-a-node.md).

Relatedly, the **canonical JSON** these signatures are computed over uses one serializer (`@circuit-llm/core`
`stableStringify` — sorted keys, drops `undefined` → valid JSON) that must stay byte-identical across
repos, pinned by golden vectors. See [canonical-serialization.md](./canonical-serialization.md).

---

## Conventions

- **ESM-first**, `"type": "module"`, NodeNext resolution, Node ≥ 22.
- **TypeScript strict** + `noUncheckedIndexedAccess`; type-only imports use `import type` (required by
  type-stripping — a value-import of an interface fails to link at runtime).
- **Dependency injection over singletons** — no global config, no hardcoded `~/.circuit` paths. Every
  effectful boundary (fetch, RPC, fs, clock, wallet) is injectable, which is what makes the suite
  offline-testable.
- **Faithful extraction** — the consume clients, the x402 flow, the custody contract, and the mesh
  protocol are taken from the systems Circuit runs in production, not reinvented, so the SDK speaks exactly
  what the network already speaks.

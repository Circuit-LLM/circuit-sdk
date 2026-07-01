# Spec — Deploying `circuit-agent` across environments

**Status:** DRAFT / proposal. Supersedes the earlier "port circuit-agent into `@circuit/skills`"
draft, which was wrong: porting the agent's logic into the SDK would duplicate it. This version is
built on the actual ecosystem — verified against `circuit-agent`, `circuit-agent-cloud` (signer +
node-host), and `circuit-agent-vault`.

## 0. Goal & non-goals

**Goal:** the SDK can **deploy `circuit-agent`** (the reference "I'm building an agent" repo) so that
it runs at full capability locally *and* in a mesh-safe form on the cloud — from **one codebase**, with
**no logic implemented twice**.

**Non-goals:**
- ❌ Don't merge `circuit-agent` into the SDK monorepo. It stays a standalone repo you keep improving.
- ❌ Don't re-implement its capabilities (tools / memory / persona / swarm / scanner / monitor) as SDK
  "skills." That's the duplication we're avoiding.
- ✅ The SDK is the **substrate**: custody, the deploy/bundle pipeline, paid (x402) inference/data, the
  base lifecycle. `circuit-agent` **consumes** it.

## 0.1 How the two repos relate (three separate relationships)

"`circuit-agent` depends on the SDK" is one of three distinct relationships — don't conflate them.
**None of them makes an SDK release reach into your repo.**

| Relationship | Direction | Does an SDK update change `circuit-agent`? |
|---|---|---|
| **1 · Library dependency** — the repo `import`s the SDK's custody (`@circuit/agent`, `@circuit/wallet`, `@circuit/inference`) | repo → uses → SDK | **No.** Pinned version (`^0.1`); you adopt new versions with `npm update` on your schedule. Semver shields against surprise breakage. |
| **2 · Deploy tooling** — `circuit agent deploy ./circuit-agent` bundles a **snapshot** of the repo and ships it | SDK CLI → packages → the repo | **No.** It photographs the repo's *current* state and deploys that; it doesn't run your live repo remotely. |
| **3 · Scaffold / template** — the repo can be the full-featured starting point you fork | SDK → gives you → a copy | **No.** `circuit agent new --template full` = a fork of `circuit-agent`; `--template minimal` = the blank stub. |

Consequences for the everyday workflow:
- **You still just install the repo.** `git clone circuit-agent && npm install && node agent.js` is unchanged
  — `@circuit/*` come down automatically as dependencies (exactly like `@solana/web3.js` does). You never
  hand-install "the SDK."
- **Local run needs no SDK *tooling*.** `node agent.js` runs a full self-custody agent with no CLI, no
  control plane, no mesh — it only uses the `@circuit/*` *library* code already in `node_modules`.
- **Install access follows the packages.** If `@circuit/*` are on a private registry, cloning the repo
  needs access to that registry (consistent with the repo already being private).
- **Dependency is one-way.** repo → SDK. The SDK never depends on `circuit-agent` → no cycle.

## 1. The mental model: one codebase, two profiles

`circuit-agent` is one program that runs in two **profiles**, decided by the environment it lands in —
not by a feature menu:

- **Full profile** — your own trusted box. Self-custody, full network, install/shell, inbound channels
  (Telegram, dashboard), every tool. This is the repo as it runs today.
- **Mesh-safe profile** — a stranger's CPU under `node-host`. A hard security sandbox (see §3): off-box
  custody (buy/sell only), egress allowlist, read-only rootfs, no inbound, x402 for all paid calls. The
  agent runs the **subset of itself** that survives that boundary.

The profile is dictated by **custody × sandbox × egress**. The agent must **detect its profile and fail
closed** — capabilities that can't be safe on the mesh are *off and enforced*, not config-flagged.

## 2. Custody matrix (the real status)

| custody | what it is | key holder | can move funds out? | status |
|---|---|---|---|---|
| **paper** (`MockCustody`) | simulation | — | no | live (SDK) |
| **local-keypair** (`LocalKeypairCustody`) | self-custody, signs locally via `@circuit/wallet.swap` | **you (on your box)** | yes (you hold the key) | **to build** (§7) |
| **signer** (`SignerCustody`) | off-box signer; agent holds a session token, **buy/sell only** | **Circuit's signer** (AES-256-GCM sealed seeds under a master key) — *custodial* | no (signer has no transfer) | **live on mainnet** — what mesh agents use today |
| **vault** (`VaultCustody`) | on-chain `circuit-agent-vault`; delegate = trade-only, **owner = sole withdraw**, on-chain guard reverts theft | **nobody but you** — truly non-custodial | no (owner-only withdraw) | **live on devnet**; mainnet-fork tested; **mainnet audit-gated** (program `9Amhs…RaxXA`) |

Key correction baked in: **mesh agents today use the *custodial* signer**, not a non-custodial wallet.
The vault is the non-custodial replacement ("retire the signer"), but it's **devnet until audit** — so
the plan must treat signer as the mainnet mesh custody *now*, and vault as the opt-in/devnet path.

## 3. The mesh is a hard sandbox (from `node-host/oci.js`)

A deployed bundle runs in an OCI container that is: **read-only rootfs · all Linux caps dropped ·
non-root · no-new-privileges · seccomp · bundle mounted read-only · one writable data dir · isolated
network with NO route except a per-node egress proxy** that only allows **hosts on the agent's resolved
egress allowlist** (host + port). No inbound. All paid calls go through **x402** (no baked API keys).

This is why the mesh capability set is a *security boundary*, not a preference.

## 4. Capability-by-profile matrix

| capability (in `circuit-agent`) | Full (local) | Mesh-safe | why the mesh limit |
|---|:---:|:---:|---|
| `buy` / `sell`, scanner/scoring, monitor/exits | ✅ | ✅ | core trading; custody-gated |
| market-data tools, memory (notes/profiles) | ✅ | ✅ | x402 + allowlist; data dir is writable |
| swarm signals / consensus / reputation / tasks | ✅ | ✅ *(if the registry host is on the allowlist)* | egress allowlist |
| `reflect` / strategy-loop / LLM reasoning | ✅ (OpenRouter **or** x402) | ✅ **x402 only** | no baked keys; gateway must be allowlisted |
| persona / `soul.md`, deterministic heartbeat | ✅ | ✅ | shipped in the bundle |
| `send_token` / withdraw | ✅ | ❌ | signer/vault can't transfer out |
| builder tools (`bash`, `write_file`, `install_package`) | ✅ | ❌ | read-only rootfs, caps dropped |
| `web_search` / `fetch_url` / `load_skill` | ✅ | ❌ *(unless host allowlisted)* | egress proxy denies non-allowlist hosts |
| Telegram (inbound chat) | ✅ | ❌ | no ingress to a sandboxed container |
| dashboard (local web UI) | ✅ | ❌ | no ingress |

"Deploy to the mesh" = the **same agent minus the verbs that are unsafe on untrusted hardware** (moving
funds, running shell, opening inbound, reaching arbitrary hosts). Not a lesser agent — a fenced one.

## 5. The one execution seam

Almost all of `circuit-agent` is custody-agnostic — tools, memory, swarm, scanner, monitor, reflect all
bottom out in `swap.buy(mint, sol)` / `swap.sell(mint, amount)`. The **only** custody-bound layer is
`lib/swap.js` / `lib/paper-swap.js`. Replace it with a thin adapter over the SDK `Custody` interface,
chosen by environment:

```
lib/execution.js  (new, in circuit-agent)
  paper      → MockCustody
  local box  → LocalKeypairCustody(walletTradeExecutor(wallet))   // self-custody
  mesh       → SignerCustody(ctx.signerUrl, session, epoch)       // node-host injects ctx
  vault      → VaultCustody(makeVaultExecutor(...))               // opt-in (devnet today)
  // exposes buy()/sell() — every other module is untouched
```

Everything else in the repo stays as-is. This is the whole structural change on the agent side, and it
makes the same codebase custody-pluggable + mesh-deployable.

## 6. Egress allowlist manifest (the network capability boundary)

The bundle declares the exact hosts the mesh agent may reach; `node-host`'s egress proxy enforces it. So
the network half of "mesh-safe" is **explicit and auditable**:

```
egress: [
  'api.circuitllm.xyz',          # data API (market/swarm/x402)
  'inference.circuitllm.xyz',    # x402 inference gateway (LLM)
  '<rpc host>',                  # Solana RPC for balances/sends
  # NOT: telegram, arbitrary web, package registries
]
```

`@circuit/bundle.createBundle({ …, egress })` already carries this field. The manifest *is* the
network capability list — and it's what makes web/telegram/`load_skill` structurally impossible on the
mesh.

## 7. The one new SDK piece: `LocalKeypairCustody`

Self-custody trading for your own box (the missing 4th custody). Mirrors `VaultCustody`: same
`PolicyEngine` gate + `IntentResult` codes, an injected `TradeExecutor` (keeps `@circuit/agent`
web3-free), and the concrete executor wraps `@circuit/wallet.swap()`:

```ts
// @circuit/agent — generalize the existing VaultTradeExecutor → TradeExecutor; add:
export class LocalKeypairCustody implements Custody {  // kind = 'local-keypair'
  // identical body to VaultCustody.run(): engine.admit() → paper? short-circuit
  //   : executor.execute() → 'local-trade'; engine.revert() on failure
}
// @circuit/wallet — the concrete executor (web3 lives here, not in @circuit/agent):
export function walletTradeExecutor(wallet: Wallet): TradeExecutor { /* buy = swap(SOL→tok), sell = swap(tok→SOL) */ }
```
`Heartbeat.custody` union gains `'local-keypair'`. This is small, self-contained, and independent of the
rest of the plan.

## 8. What changes where (no duplication)

| | SDK (`circuit-sdk`) | `circuit-agent` (standalone repo) |
|---|---|---|
| Custody | **add** `LocalKeypairCustody` + `walletTradeExecutor`; signer/vault/paper already exist | consume them via `lib/execution.js` (§5) |
| Capabilities (tools/memory/persona/swarm/scanner/monitor/…) | none — **not** ported | **stay here, the single source** |
| Profile detection + fail-closed gating | (lifecycle hook if useful) | **add** — read the runtime ctx, disable mesh-unsafe modules |
| Egress manifest | `@circuit/bundle` already supports `egress` | **declare** its allowlist (§6) |
| Deploy pipeline (bundle → control-plane → node-host) | already exists | `circuit agent deploy ./circuit-agent` |
| Dependencies | — | takes `@circuit/agent`, `@circuit/wallet`, `@circuit/inference` as npm deps (still a separate repo) |

Result: capabilities live **only** in `circuit-agent`; the SDK owns custody + deploy + paid inference.
Every improvement you make in the repo ships automatically, because the SDK deploys *that repo*.

## 9. Deploy flow (end state)

```
LOCAL (full profile):   node agent.js            # self-custody (LocalKeypairCustody), every capability
                        circuit agent create --custody local
MESH (mesh-safe):       circuit agent deploy ./circuit-agent
                          → @circuit/bundle packs it (+ egress manifest, secret exclusion)
                          → control-plane schedules it
                          → node-host runs it sandboxed; injects signer session (off-box custody)
                          → agent detects mesh profile → fails closed on builder/telegram/web/send
```

## 10. Build order

1. **`LocalKeypairCustody` + `walletTradeExecutor` + tests** (SDK) — small, independent; unblocks real
   local self-custody trading.
2. **`lib/execution.js` adapter** in `circuit-agent` (swap → SDK `Custody`), behind a flag; default =
   today's self-custody behavior, nothing breaks.
3. **Profile detection + fail-closed capability gating** in `circuit-agent` (mesh vs full).
4. **Egress manifest** + `circuit agent deploy ./circuit-agent` proven end-to-end to the mesh on the
   **signer** path.
5. *(Later)* vault custody on mainnet once audited; until then it's the devnet/opt-in path.

## 11. Open decisions

- **Repo→SDK dependency**: confirm `circuit-agent` taking `@circuit/*` as deps (recommended) vs. a
  looser adapter. This is the crux of "no duplication."
- **Mesh LLM**: pin the x402 inference gateway host on the egress allowlist; confirm `reflect` /
  strategy-loop run headless on the mesh (no chat channel).
- **Headless brain on mesh**: does the LLM `processor` run on the mesh (reasoning, no inbound) or is it
  disabled there? (Leaning: runs, but with no Telegram/dashboard surface.)
- **Vault on mesh**: offer `--custody vault` for devnet testing now; keep signer as the mainnet default
  until the vault audit clears.

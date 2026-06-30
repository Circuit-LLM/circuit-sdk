# Circuit Agent Cloud — Design Spec

> A decentralized, CPU-based hosting layer for autonomous agents. Users launch
> agents that run 24/7 on the Circuit mesh; node operators contribute spare CPU
> on their own terms and earn CIRC for it. Inference stays on the GPUs; agents
> live on the CPUs that hang off the same node-clients.

**Status:** built (alpha) · **Scope:** CLI + node-client + a thin control plane ·
**Token of account:** CIRC (x402)

---

## 0. Revision — what was built (supersedes the tiered/toll design below)

The system is implemented in **[circuit-agent-cloud](https://github.com/Circuit-LLM/circuit-agent-cloud)** and driven by `circuit agent`. Two simplifications were made versus the original RFC, and the code follows the simplified model:

1. **Custody is ONE mechanism, not a spectrum.** Every agent uses the **off-box signer**: the signing key is generated and held by the signer service, sealed at rest (AES-256-GCM), and **never** reaches the operator node — which only ever gets a scoped, rotating **session token**. The signer's verbs are `buy | sell` only (no transfer/withdraw), so funds can never leave the agent wallet through the autonomous path; the worst a rogue operator can do is an in-policy swap. This is §8's **T2 off-box signer**, made the single path. The tiers (T0 key-on-node / T1 Allowance / T3 TEE) are **not** exposed — a later MPC or TEE signer can sit behind the *same* API with no change to agents or hosts.
2. **No hosting toll.** Hosting is not metered or charged in v1. §10 (payments/toll) is **not implemented** and is out of scope for now.

The **at-most-one fence** (§9) is built into the signer: a session carries a monotonic epoch; opening a new one on reschedule supersedes the old, so a crashed node's orphan is fenced out (its intents are rejected as stale). Users run **unlimited different agents**; each agent runs in exactly one place at a time.

**Live trading is wired.** When `paper=false`, the signer builds the swap *itself* from the approved intent (taker = the agent's own wallet), signs the returned transaction with the off-box key (zero-dep, native Ed25519 — the byte surgery is unit-tested), and lands it via **Jupiter Ultra** (which broadcasts, so no RPC is needed). The signer never signs operator-supplied bytes, so it can only ever swap the agent's own funds. The rest of this document is the original RFC and is kept for context — where it conflicts with this section, this section wins.

---

## 1. Goals & non-goals

**Goals**
- Run a user's agent (a `circuit-agent` instance) **continuously in the cloud**, not on their laptop — so stop-losses are monitored even when their machine is off.
- Use **distributed CPU capacity** contributed by node operators — the same mesh that serves inference.
- **Operator opt-in and bounded:** each operator decides exactly how much CPU / RAM / disk to lend, whether to allow confidential workloads, and can revoke at any time. Hosting is **off by default**.
- **Custody is tiered and pluggable** — from "Circuit runs the node" to "key never touches the host" to "sealed in a TEE" — without forcing the hard tier on day one.
- **Self-funding in CIRC:** agents pay a metered hosting toll; operators are paid through the **existing** revenue-ledger + distributor.
- Wire cleanly into the **CLI** (the launcher) and the **node-client** (the host), reusing the live auditor, payout, and x402 rails.

**Non-goals (v1)**
- Confidential *GPU* inference (separate concern — agents are CPU-only).
- A general-purpose container PaaS — scope is Circuit agents.
- Live VM migration beyond what is reconstructable from on-chain state.

---

## 2. Reuse vs. build

| Already live (reuse) | New (build) |
|---|---|
| `circuit-agent` (the workload) + the swarm/PM2 pattern | Control Plane (scheduler/registry) |
| node-client (mesh connection) + trust auditor (probation→trusted) | node-client **agent-host** module |
| revenue-ledger + distributor + `circuit-payout.timer` (30 min) | Hosting-toll metering + attribution |
| x402 / CIRC / treasury `2jj34NBJ…` | CLI `agent` module + `cloud` driver |
| Solana native Allowances (custody) | Custody adapters (off-box signer / TEE) |

The intent is a **small** amount of net-new code sitting on top of mature pieces.

---

## 3. Components

```
┌── user ──┐        ┌──────── Control Plane ────────┐        ┌── operator ──┐
│  CLI     │ HTTPS  │  scheduler · registry · ledger │  gRPC  │  node-client │
│ `agent`  │ ─────► │  (stateless API + Postgres)    │ ◄────► │ `agent-host` │
└──────────┘        └────────────────────────────────┘        └──────┬───────┘
                                                                      │ runs
                                                          sandboxed agent containers
                                                          (cgroups / TEE / custody adapter)
```

1. **CLI `agent` module** — user-facing. Two drivers behind one command set: `local` (spawn on the user's machine) and `cloud` (call the Control Plane). Also the **operator console** (`circuit agent host`) for contributing capacity.
2. **Control Plane (Agent Orchestrator)** — stateless API + a small datastore. Holds the node registry, capacity, trust/TEE capability, agent assignments, and (client-side-encrypted) agent config. Schedules, heartbeats, fails over, and attributes hosting revenue.
3. **node-client `agent-host`** — an opt-in capability. Reads the operator's resource budget, advertises spare capacity, pulls assigned agents, runs them sandboxed under hard limits, reports health + usage, drains gracefully.
4. **Agent runtime** — the signed `circuit-agent` image, started with a resource profile and a **custody adapter** for signing.
5. **Custody layer** — pluggable: key-on-node / Allowance-bounded / off-box-(MPC)-signer / TEE-sealed.
6. **Payments** — metered CIRC toll → revenue-ledger → distributor (operators paid every 30 min; confidential nodes earn a premium).

---

## 4. The operator contribution model (the opt-in controls)

This is the heart of "give operators the choice." Best practice: **explicit, bounded, revocable, safe-by-default.** The operator declares a budget in the node-client config (or via `circuit agent host`):

```toml
[agent_host]
enabled        = false          # OFF by default — explicit opt-in
max_cpu        = 2.0            # fractional cores (cgroup cpu.max quota)
max_memory_mb  = 4096
max_disk_gb    = 20             # size of the dedicated encrypted state volume
max_agents     = 25            # hard ceiling regardless of headroom
schedule       = "always"      # "always" | "idle-only" | "windows:[22:00-08:00]"
idle_threshold = 0.4           # for "idle-only": yield when host load > 40%
confidential   = "auto"        # "off" | "auto" (TEE if HW supports) | "required"
custody_max    = "allowance"   # max custody risk this node will accept:
                               #   "none" (off-box only) | "allowance" | "tee" | "any"
egress         = "allowlist"   # restrict agent egress to Circuit + RPC + Jupiter
```

Rules:
- The runner **enforces** the budget with cgroups v2 (`cpu.max`, `memory.max`, `pids.max`, `io.max`) and a dedicated, size-capped encrypted volume. The control plane is *told* `available = budget − in_use` each heartbeat and **never schedules past the budget**; cgroups are the hard backstop if it tries.
- **`idle-only`** lets a GPU contributor lend CPU only when the box is below `idle_threshold`, so **agents always yield to inference**.
- **`custody_max`** lets an operator refuse to hold keys at all (`none` → only off-box-signer agents land here), cap at Allowance-bounded, or accept TEE-sealed. The scheduler honors it.
- **Revocable:** lowering the budget or `enabled=false` triggers a **graceful drain** — affected agents checkpoint and reschedule elsewhere before the node releases them.
- The operator sees their contribution + earnings via `circuit agent host --status`.

---

## 5. CLI wiring (`src/modules/agent.js` + `src/services/agents.js`)

Follows the existing layered rule — `services` talk, `ui` draws, `modules` glue — and the registry pattern.

```
src/
  services/
    agents.js                 # orchestration API client
    drivers/local.js          # spawn/PM2 on this machine
    drivers/cloud.js          # Control Plane REST client
  modules/agent.js            # `agent` command + screens
```

**User commands**

```bash
circuit agent create <name> [--strategy dip] [--budget-sol N] [--allowance N]
circuit agent fund <name>                 # show address / deposit / sweep out
circuit agent start <name> [--local|--cloud] [--confidential] [--region eu]
circuit agent stop <name>
circuit agent list                        # status · P&L · node · $/mo
circuit agent logs <name> [-f]
circuit agent status <name>
circuit agent destroy <name>              # confirm-gated; sweeps funds first
```

**Operator commands** (same CLI, other side of the market)

```bash
circuit agent host                        # interactive: set budget, confidential?, custody_max
circuit agent host --status               # contributed capacity, agents running, CIRC earned
circuit agent host --off                  # graceful drain + stop contributing
```

Best practices: verb-first commands, `--json` everywhere for scripting, **confirmations on any spend or destroy**, and `--local` works with zero backend (it's just the swarm pattern for one user).

---

## 6. node-client wiring (`agent-host` module)

Added alongside the existing inference + (planned) dRPC capabilities. The node-client already *is* "the thing that connects compute to the mesh"; this makes it multi-resource.

**Lifecycle**
1. **Register.** On start, if `enabled`, POST `nodes/register` with `{ nodeId, capabilities, budget, tee_attestation? }`. Capabilities advertise `cpu`, `tee: sev-snp|tdx|none`, region.
2. **Heartbeat loop** (every ~10s). POST `nodes/heartbeat { available, running[], usage }` → receive `assignments[]` (`start` / `stop` / `drain`).
3. **Run.** For a `start`: pull the **signed** `circuit-agent` image (verify signature/digest), create a per-agent cgroup + mount its slice of the encrypted volume, inject config + the custody handle, launch sandboxed.
4. **Supervise.** Restart on crash (with backoff), enforce limits, stream health/usage to the control plane and logs to the log sink.
5. **Drain.** On `drain` / budget cut / shutdown: signal the agent to checkpoint, deregister it, free resources. The control plane reschedules.

**Sandboxing (best practice — least privilege)**
- Rootless runtime (Podman/containerd), **read-only rootfs**, no host bind-mounts, dropped capabilities, **seccomp + AppArmor** profiles, per-agent cgroup, `pids.max`.
- **Egress allowlist** (Circuit endpoints + the configured RPC + Jupiter) — an agent can't phone home anywhere else.
- Hard isolation from the node's inference process and from sibling agents.

**Confidential mode**
- If `confidential = required` (or `auto` + TEE present), the agent runs inside a **Confidential VM** (CoCo/Kata on SEV-SNP or TDX). The agent's secret (key/Allowance) is released **only after remote attestation** by the Key Broker — the operator never sees it. Non-TEE nodes simply never receive confidential assignments.

---

## 7. Control Plane API (interfaces)

**Node ↔ Control Plane** (gRPC or REST; mTLS + node-key signatures)

| Method | Body | Returns |
|---|---|---|
| `POST /nodes/register` | `nodeId, caps, budget, attestation?` | session token |
| `POST /nodes/heartbeat` | `available, running[], usage` | `assignments[]` |
| `POST /agents/:id/report` | `state, health, lastTradeTs, usage` | ack |

**CLI ↔ Control Plane** (HTTPS; user-key signatures)

| Method | Notes |
|---|---|
| `POST /agents` | create; **config encrypted client-side** (plane stores ciphertext) |
| `POST /agents/:id/start` | `{ confidential?, region?, custody_tier }` |
| `POST /agents/:id/stop` · `DELETE /agents/:id` | confirm-gated destroy sweeps funds |
| `GET /agents/:id` · `GET /agents` | status / list |
| `GET /agents/:id/logs?follow=1` | streamed from the node via the plane |

**Scheduling** = bin-pack onto the cheapest node that satisfies `{ cpu, mem, custody_tier ≤ node.custody_max, confidential ≤ node.caps }`, preferring trusted/attested nodes. Records `{agentId → nodeId}` for payout attribution.

---

## 8. Custody spectrum (opt-in, scheduler-routed)

> **SUPERSEDED by §0.** Not built as a spectrum. Shipped as the single **off-box signer** (this section's T2), with live trading via Jupiter Ultra. No tiers are exposed. Kept for design context.

| Tier | Where the key is | Runs on | Loss if operator is malicious |
|---|---|---|---|
| **T0 key-on-node** | plaintext on host | Circuit-owned nodes only | full (acceptable — we *are* the host) |
| **T1 Allowance** | on host, but a **capped, expiring** Solana delegation | any node | bounded to the trading budget |
| **T2 off-box / MPC** | **never on the host** — agent emits signed intents to a signer / threshold-MPC across nodes | any CPU, no TEE | **none** (host can't sign); only front-running |
| **T3 TEE** | sealed in the enclave, attestation-gated | SEV-SNP / TDX nodes | none (host can't read it) |

An agent declares its **required** tier; the scheduler only places it on nodes whose `custody_max` allows it. T0/T1 ship first; T2 (off-box signer) is the sweet spot for untrusted CPUs without TEE; T3 is the confidential endgame.

---

## 9. State, durability & failover

- **Positions are on-chain** — they're the agent wallet's balances. The agent reconstructs them on boot, so a reschedule loses nothing material. This is the core resilience trick.
- **Config + cooldowns + journal** live in the control-plane datastore, encrypted; checkpointed periodically.
- **Failover:** missed heartbeats → mark agent unhealthy → reschedule → new node pulls config + reconstructs from chain + resumes. **Idempotent** — the agent re-derives state, so no double-trade.
- **At-most-one** invariant: the control plane fences an agent (lease/token) so a partitioned old node can't keep trading after reassignment.

---

## 10. Payments & economics

> **SUPERSEDED by §0 — NOT implemented.** There is no hosting toll; hosting is unmetered in v1. Kept for design context.

- **Metered toll:** `price = a·cpu_seconds + b·ram_gb_hours + confidential_premium`, billed in CIRC over x402 on a cadence (hourly) from the agent wallet.
- **Attribution:** the toll is recorded in the **existing** revenue-ledger as `{agentId, nodeId, amount}`; the **existing** distributor pays the hosting operator every 30 min. Confidential nodes earn a premium. A small protocol cut accrues to Circuit.
- **Self-funding:** the user funds the agent wallet (SOL to trade + CIRC to pay its way); the agent already pays CIRC for data + inference, so hosting is just one more line item. At ~$1/agent·mo confidential cost and a modest toll, the cloud is net-neutral-to-positive and deepens CIRC demand.

---

## 11. Security & ops (best practices)

- **Safe defaults:** hosting OFF until explicitly enabled; egress allowlisted; rootless + read-only rootfs.
- **Least privilege & isolation:** seccomp/AppArmor, cgroups, no host access, agent ⟂ inference ⟂ sibling agents.
- **Signed, pinned images:** verify the `circuit-agent` digest/signature before running; deny unsigned.
- **Secrets never at rest in plaintext:** client-side-encrypted config; T2/T3 keep keys off the host entirely / sealed.
- **Defense in depth:** custody tier *and* sandbox *and* the live auditor (misbehaving nodes get evicted, exactly as today).
- **Observability:** structured logs, per-agent + per-node metrics (cpu, mem, restarts, trades, toll), health checks, alerting.
- **Graceful drain** on budget change / shutdown; **backoff** on crash loops; **rate limits / quotas** to stop a rogue agent hogging a node.
- **Capability negotiation:** nodes advertise what they support; the plane never assumes TEE/MPC that isn't there.

---

## 12. Phased rollout

| Phase | What ships | Custody | Hosting |
|---|---|---|---|
| **P1** | CLI `agent` + `local` driver | T0 (user's disk) | the user's own machine — free |
| **P2** | Control Plane + node-client `agent-host`, operator budgets, CIRC toll via distributor | T0/T1 | **Circuit-owned** CPU nodes |
| **P3** | Open to community CPU nodes | **T2 off-box / MPC** | any CPU (no TEE needed) |
| **P4** | Confidential nodes + Key Broker/attestation | **T3 TEE** | SEV-SNP / TDX nodes, premium |

Each phase is independently shippable and they coexist — the scheduler simply routes each agent to the cheapest node meeting its trust requirement. P1–P2 prove the product on hardware you already run; P3 is where it becomes a true decentralized cloud; P4 is the trustless tier.

---

## 13. Open questions

- **MPC signer topology** for T2 — threshold across which nodes, and the latency budget for a trade.
- **Hosting-toll price discovery** — fixed schedule vs. a reverse auction across nodes (Akash-style).
- **Log/state store** — control-plane Postgres vs. client-side-encrypted decentralized storage for portability.
- **Attestation root** — run Trustee ourselves first, decentralize the Key Broker later.
- **Fair scheduling** — preventing a few big operators from monopolizing high-value (confidential) placements.

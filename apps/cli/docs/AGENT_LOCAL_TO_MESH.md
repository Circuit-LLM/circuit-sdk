# Spec — Local agent dev → Deploy to Mesh (CLI)

**Goal.** A user scaffolds an agent, develops and runs it **locally** on their own machine (fast loop,
real logs, paper trading), and when it's ready **promotes the same code to the Circuit mesh** with one
command — all from `circuit`. Write once, run two places; the runtime injects the difference.

**Status:** draft / not yet implemented. Owner: CLI. Related: `circuit-sdk/@circuit/agent`,
`circuit-agent-cloud` (node-host + control-plane), `services/bundle.js` (already built).

---

## 1. What already exists (don't rebuild)

The hard part — **runtime parity** — is already solved in `@circuit/agent` (circuit-sdk):

- **`agent.ts` (`CircuitAgent`)** owns the workload contract: env wiring, heartbeat, the scan→decide→
  trade loop. It reads a fixed env contract:
  `CIRCUIT_AGENT_DATA_DIR`, `CIRCUIT_AGENT_ID`, `CIRCUIT_AGENT_EPOCH`, `CIRCUIT_AGENT_SESSION`,
  `CIRCUIT_AGENT_ADDRESS`, `CIRCUIT_AGENT_PAPER`, `CIRCUIT_SIGNER_URL`.
- **`custody.ts`** abstracts custody behind one interface:
  - `SignerCustody` → the off-box signer (mesh): the key never touches the host; buy/sell-only; epoch fence.
  - `MockCustody` → **local paper trading, no signer**, mirroring the signer's policy + rejection codes.
  - **The switch is the env**: `CIRCUIT_SIGNER_URL`/`SESSION` present → SignerCustody; absent → MockCustody.
    Same `this.buy()/this.sell()` in the agent — identical semantics both ways.
- **`scaffold.ts` + the `circuit-agent` bin** generate a starter project (`agent.ts`, `package.json`,
  `config.json`, `README.md`); `npm start` runs it locally in paper mode.
- **CLI `services/bundle.js`** already publishes a folder as a content-addressed, **signed, secret-safe**
  bundle (hard-excludes `.env`/keys, honors `.gitignore`/`.circuitignore`), and the node-host verifies
  sha256 + signature before running it. The cloud driver (`services/drivers/cloud.js`) creates the agent
  on the control-plane with wallet-signed owner auth.
- **node-host `env.js`** already curates a hosted (untrusted) bundle's env: endpoint URLs only, **never**
  the operator's secrets; identity/custody vars are injected by the host.

**Conclusion:** the agent runtime, custody parity, scaffolding, secret-safe bundling, and cloud
placement all exist. The gap is **the CLI never wires the local dev loop to a user's own folder, and
never connects "a local agent" to "promote it to the mesh."**

---

## 2. The gap (what's missing today)

1. **No scaffold in the main CLI.** `scaffold()`/`circuit-agent new` lives in the SDK's separate bin, not
   `circuit agent`. A `circuit` user has no "start a new agent" entry point.
2. **The local driver can't run user code.** `services/drivers/local.js` only spawns the built-in
   `agentd`/`circuit-agent` workloads from `config.agentCloudDir`/`circuitAgentDir` — repos a distributed
   user doesn't have. There is no "run *this folder's* entry file" path.
3. **No local→mesh promotion.** `create --bundle` forces `--cloud`; there's no "I have a local agent,
   deploy *it*" verb. The local and cloud lifecycles are disconnected.
4. **No project manifest.** The bundle publisher defaults `entry: 'agent.js'`, but the SDK scaffold emits
   `agent.ts`. Nothing declares entry / egress / runtime / required-secret-names per project.

---

## 3. Target UX — the developer journey

```
circuit agent new alpha            # scaffold ./alpha (SDK template + a circuit.agent.json manifest)
cd alpha && npm install
circuit agent dev                  # run THIS folder locally, foreground, live logs, paper, your wallet
                                   #   (Ctrl-C stops; edit code; re-run — the dev loop)
circuit agent run alpha --local    # OR run it detached/background, managed like any agent
circuit agent logs alpha           # works for local + cloud
circuit agent deploy alpha         # promote the SAME folder to the mesh:
                                   #   bundle (secret-safe) → publish → create cloud agent (off-box custody)
circuit agent list                 # shows local + cloud agents together, with WHERE each runs
```

Interactive (Agents menu) mirrors this: **New agent**, **Run locally (dev)**, **Deploy to Mesh** (exists).

**The promise:** the folder you `dev` locally is byte-for-byte the folder you `deploy`. Only the runtime
differs — locally MockCustody/paper + your `.env`; on the mesh SignerCustody + host-injected env.

---

## 4. The agent project contract

A scaffolded folder:

```
alpha/
  agent.ts            # entry — extends CircuitAgent, implements the strategy; `new Alpha().run()`
  circuit.agent.json  # NEW manifest (see below)
  config.json         # strategy/runtime config (scan interval, thresholds…)
  package.json        # deps: @circuit/agent; "start": node agent.ts
  .env                # LOCAL secrets (gitignored, NEVER bundled)
  .env.example        # documents the secret NAMES the agent needs
  .gitignore          # .env, node_modules, *.key, id.json …
  README.md
```

### 4.1 `circuit.agent.json` (new — the single source of truth for both runtimes)

```jsonc
{
  "schema": 1,
  "name": "alpha",
  "entry": "agent.ts",            // what to run (local) + bundle entry (mesh) — reconciles the agent.ts/agent.js mismatch
  "runtime": "node",
  "sdk": "@circuit/agent@<ver>",
  "egress": ["api.circuitllm.xyz", "price-feed"],  // hosts the mesh egress sidecar allows
  "resources": { "maxMemoryMb": 512 },
  "secrets": ["OPENROUTER_API_KEY"],                // NAMES only — values come from .env (local) or runtime injection (mesh)
  "custody": { "maxTradeSol": 0.05, "maxDailySol": 0.5, "cooldownMs": 30000 }
}
```

The CLI reads this for **both** local run (entry, config) and deploy (entry, egress, resources, sdk →
`publishDir`), so the two paths can't drift. `secrets` are declared **names**, never values.

### 4.2 The env contract (what the CLI provides at runtime)

| Var | Local (`dev`/`run --local`) | Mesh (`deploy`) |
|---|---|---|
| `CIRCUIT_AGENT_DATA_DIR` | `~/.circuit/agents/<name>` | host-assigned data dir |
| `CIRCUIT_AGENT_ADDRESS` | the agent's wallet address | from the signer session |
| `CIRCUIT_AGENT_PAPER` | `1` (unless `--live`) | per policy |
| `CIRCUIT_SIGNER_URL` / `_SESSION` | **absent** → MockCustody (paper) | injected by node-host → SignerCustody |
| `CIRCUIT_API_URL` / `PRICE_FEED_URL` / `CIRCUIT_INFERENCE_URL` | from CLI config | curated by node-host |
| app secrets (declared names) | loaded from `.env` | injected at deploy (never in the bundle) |

This is exactly the contract `@circuit/agent` already reads — the CLI just has to set it.

### 4.3 Local custody / wallet

Recommend a **per-agent keypair**, generated on `new` (or first `dev`) and stored in the agent's data
dir, funded by the user. Reasons: matches the cloud model (owner = your main wallet, agent has its own
address), keeps your main key out of the loop, and paper-by-default means an unfunded key is harmless.
`--live` arms real trading locally (full trust — your machine, your key).

---

## 5. Implementation tasks (by repo, phased)

### Phase 1 — Scaffold + local run (the dev loop)

**circuit-cli**
1. `services/scaffold.js` — generate the project. Two options: **(a)** depend on `@circuit/agent` and call
   its `scaffold(name)`; **(b)** vendor the template. Recommend (a) for parity; add `circuit.agent.json`
   + `.env.example` + `.gitignore` on top of the SDK's files.
2. `modules/agent.js` — `circuit agent new <name>` (+ interactive "New agent"): write the folder, print
   next steps (`cd`, `npm install`, `circuit agent dev`).
3. `services/manifest.js` — read/validate `circuit.agent.json` (entry safe, schema, egress shape).
4. `services/drivers/local.js` — **run user code**: if `meta.spec.local = { dir, entry }`, spawn
   `node [--experimental-strip-types] <dir>/<entry>` instead of agentd. Build the local env (table 4.2),
   load the folder's `.env`, merge `spec.env`, set the per-agent keypair. Keep pid/heartbeat/log mgmt.
5. `modules/agent.js` — `circuit agent dev [dir]` (foreground, streamed logs, Ctrl-C stops, paper) and
   `circuit agent run <name> --local --dir <dir>` (detached). Stop forcing `--cloud` except for `--bundle`.

**Deliverable:** `new` → `dev` runs a user's agent locally in paper mode with real logs.

### Phase 2 — Promotion (local → mesh)

**circuit-cli**
6. `circuit agent deploy <name>` — promote an existing local agent (or `--dir`): read the manifest →
   `publishDir({ dir, entry, egress, sdk, resources })` (already secret-safe) → `cloud.create` with
   owner = your wallet. This is the existing Deploy-to-Mesh flow, now driven from the manifest + by name.
7. `list` — merge local + cloud agents; show a `WHERE` column (local / mesh / both) and state.
8. **Runtime secret injection** — at deploy, for each `secrets` name the manifest declares, prompt for a
   value (or read from the local `.env`) and attach to `spec.env`. Values travel out-of-band to the
   node-host, **never** in the bundle. (See §6 for the trust note.)

**circuit-agent-cloud** (optional)
9. A `POST /v1/bundles/verify` (or reuse verify) the CLI calls pre-deploy to confirm the bundle will be
   accepted (sha/sig/owner) before creating the agent — fail fast with a clear message.

**Deliverable:** `deploy alpha` puts the same folder on the mesh under off-box custody.

### Phase 3 — Parity, polish, safety rails

**circuit-cli**
10. `circuit agent check [dir]` — lint before deploy: manifest valid, entry exists, no banned imports
    (fs-escape, child_process for an untrusted bundle), declared secrets present, egress sane. Mirror the
    node-host's acceptance rules so "passes check" ⇒ "the node will run it."
11. Tests: scaffold produces a runnable agent; local run start/stop/logs; deploy bundles with **no**
    secrets (extend the existing bundle test); a promoted bundle verifies under the cloud verifier (the
    `bundle-consistency` test already covers the crypto).

**circuit-sdk** (only if needed)
12. Confirm `MockCustody` ↔ `SignerCustody` reject with identical codes (already claimed in `custody.ts`);
    add a parity test if missing. Keep `scaffold()` and the CLI template in lockstep (single source).

---

## 6. Custody & secrets — the promotion contract

| | Local (`dev`/`run`) | Mesh (`deploy`) |
|---|---|---|
| **Custody** | MockCustody (paper) or a local keypair (`--live`) | off-box SignerCustody (or the non-custodial vault) |
| **Owner / withdraw** | you (your machine) | your wallet — sole withdraw authority |
| **Secrets** | `.env`, full trust (your box) | declared NAMES → values injected at deploy; **never bundled** |
| **Trust boundary** | none (your machine) | untrusted host — code is signed + verified, env is curated |

**Secret-injection trust note (decision in §7):** `spec.env` travels through the control-plane in plaintext
today, so Circuit *could* see those values. That's fine for keys you'd hand Circuit anyway, and the
**trading key is never affected** (off-box signer / vault). For zero-trust app secrets the follow-up is
per-node encryption (owner encrypts to the node's pubkey; the CP can't read) — out of scope for v1.

---

## 7. Open decisions (need a call before building)

1. **Local wallet** — per-agent generated keypair (recommended) vs the user's main wallet.
2. **Scaffold source** — depend on `@circuit/agent` `scaffold()` (recommended, parity) vs vendor a template
   in the CLI (zero extra dep, risk of drift).
3. **Entry convention** — settle the `agent.ts` (SDK scaffold) vs `agent.js` (bundle default) split via the
   manifest `entry` field (recommended) so both runtimes read one value.
4. **TS execution locally** — rely on Node `--experimental-strip-types` (Node 22+) vs requiring a build
   step. Affects the `dev` command + the minimum Node version we document.
5. **Cloud secret injection** — `spec.env` plaintext-through-CP now (recommended for v1) vs build
   encrypted-to-node first.

---

## 8. Milestones

- **M1 (Phase 1):** `new` + `dev` + local `run` — a user can build and run an agent locally. *Highest value, smallest surface.*
- **M2 (Phase 2):** `deploy` promotion by name + `list` parity + secret injection.
- **M3 (Phase 3):** `check` lint + parity tests + docs (this file → `commands.md`).

Estimated surface: ~4 new/changed CLI files (scaffold, manifest, local driver, agent module), one new
manifest format, optional CP verify endpoint. No new runtime — the SDK already carries it.

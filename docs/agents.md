# Agents

`@circuit/agent` is the agent runtime: write an autonomous agent that runs on Circuit's CPU mesh with
**off-box, non-custodial signing**. You extend `CircuitAgent` and implement `tick()` — the runtime owns
everything else (env wiring, custody, heartbeat, logs, lifecycle). The same code paper-trades locally
and runs live on borrowed hardware.

- [The idea](#the-idea)
- [Write one](#write-one)
- [Off-box custody](#off-box-custody)
- [buy / sell](#buy--sell)
- [Lifecycle](#lifecycle)
- [Local dev with MockCustody](#local-dev-with-mockcustody)
- [Paying for inference vs. trading custody](#paying-for-inference-vs-trading-custody)
- [Scaffold a project](#scaffold-a-project)
- [Hosting](#hosting)

---

## The idea

A Circuit agent composes the whole stack — it *thinks* (inference), *senses* (data), *acts*
(custody/trading), and *lives* somewhere (hosting). The hard part isn't the strategy; it's running
someone else's code on your hardware without letting it steal funds. Circuit solves that with **off-box
custody**: the signing key lives in a signer service, never on the host, and the only verbs are
`buy`/`sell` within the owner's policy. The SDK hands you that contract as a base class.

---

## Write one

```ts
import { CircuitAgent } from '@circuit/agent';

class DipBot extends CircuitAgent {
  async setup() {
    this.cfg = this.readConfig();              // <dataDir>/config.json
    this.log('dip-bot ready');
  }

  async tick() {                               // called every intervalMs
    const trending = await this.data().tokenTrending();   // sense (free here)
    const pick = pickDip(trending);            // your strategy
    if (pick) {
      const r = await this.buy(pick.mint, 0.01);          // act — off-box signer
      if (r.ok) { this.positions.push({ symbol: pick.mint, sizeSol: 0.01 }); this.log(`bought ${pick.mint}`); }
      else this.log(`buy rejected: ${r.code}`);           // fenced | cooldown | over-trade-cap | …
    }
  }

  async onDrain() { await this.checkpoint(); } // node budget cut / reschedule
}

new DipBot().run();
```

`run()` reads config, calls `setup()`, starts the loop, and wires `SIGTERM`/`SIGINT` to a graceful stop.
You touch only `setup()` and `tick()` (and optionally `onDrain()`/`checkpoint()`).

---

## Off-box custody

> `@circuit/agent` has **four custody modes** — paper (`MockCustody`), self-custody (`LocalKeypairCustody`,
> [see below](#local-paper-mockcustody--self-custody-localkeypaircustody)), off-box **signer**, and the
> non-custodial on-chain **vault**. This section is the **off-box signer** — the model for running on the
> *mesh* (a stranger's CPU), where the agent must never hold the key.

`this.buy` / `this.sell` go to **custody**, not to a key the agent holds:

- **The key never touches the host.** The signer generates a Solana wallet per agent and seals it at
  rest. The agent receives only a scoped **session token** + a monotonic **epoch** (the fence) — good for
  *requesting* in-policy trades, useless for theft.
- **Funds can't leave.** The signer's vocabulary is `buy | sell` only. There is no transfer/withdraw
  verb, so value stays in the agent wallet. **Worst case for a rogue host: an in-policy swap, never a
  drain.** The owner withdraws with their own key.
- **Policy is enforced on every intent** — `maxNotionalSol`, `maxDailySol`, `cooldownMs`, `allow`,
  `denyTokens`, `allowTokens`:

  ```ts
  const DEFAULT_POLICY = {
    maxNotionalSol: 0.05, maxDailySol: 0.5, cooldownMs: 30000,
    allow: ['buy', 'sell'], denyTokens: [], allowTokens: null, paper: true,
  };
  ```
- **At-most-one (the fence).** Each agent has one wallet, so at most one instance may trade it. On a
  reschedule/failover the control plane opens a new session (epoch++), superseding the old — a crashed
  node's orphaned copy is fenced out, its intents rejected as `fenced`.

A rejected intent never throws — it resolves to `{ ok: false, code, error }`. Codes you'll see:
`fenced`, `cooldown`, `over-trade-cap`, `over-daily-cap`, `action-not-allowed`, `token-denied`,
`token-not-allowed`, `signer-unreachable`.

### What a host can — and can't — do

Your agent's code runs on a stranger's machine, so every protection comes from the **off-box signer** —
never from trusting the host. The boundary:

| A malicious host… | …because |
|---|---|
| **cannot** move funds out of the agent wallet | the signer's only verbs are `buy`/`sell` — there is no transfer/withdraw |
| **cannot** trade outside your policy | caps, cooldown, and allow/deny lists are enforced off-box |
| **cannot** run two copies trading at once | the monotonic-epoch fence supersedes the old session |
| **cannot** touch a paper agent's value | paper mode never broadcasts a trade |
| **cannot** make a trade your strategy didn't | **Verified Intents** — the signer re-runs your committed rule on *authenticated* inputs and signs only the trade that rule actually produces |

That last row is the one that matters when your logic runs on hardware you don't control, and **Verified
Intents closes it.** Commit a decision rule, and the signer signs a trade only if your rule — re-run on
signed data / inference receipts / zkTLS — produces exactly that trade. A tampered agent, faked data, or a
host-chosen trade is rejected *before* anything is signed (`decision-unjustified` / `evidence-invalid`).
It's pure software and runs on any CPU — **[turn it on → verified-intents.md](verified-intents.md)**.

So: **funds can't be stolen, and trades can't be forged.** Two edges remain, and neither lets a host
invent a trade:

- **Withholding / timing** — a host can refuse to submit a valid trade, or pick *when* among
  genuinely-justified moments. It can drop or delay your trade, never fabricate one. Conservative caps and
  small funding bound the impact.
- **Opaque strategies** — Verified Intents covers anything the signer can re-check: a deterministic rule,
  or a rule over a signed-AI verdict (which is most agents). A true black box the signer *can't* re-run
  uses the hardware path instead — **[Sealed Agents](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/SEALED_AGENTS.md)**,
  where a TEE attests the whole agent and works for any strategy.

> Verified Intents is opt-in per agent (`requireVerifiedIntent`). Until you commit a rule the signer
> enforces policy caps only, so a host could pick among *in-policy* trades — committing a rule is the
> one step that closes that, and it's the recommended way to run a trading agent.

---

## buy / sell

```ts
const r = await this.buy(mint, 0.01);                          // 0.01 SOL notional
const s = await this.sell(mint, { sizeSol: 0.01 });            // paper sell
const s2 = await this.sell(mint, { amount: 1_000_000, maxSlippageBps: 100 });   // live sell (token base units)

if (r.ok) {
  // r.code === 'signed' (paper) or 'submitted' (live); r.signature, r.txid, r.solValue, r.daySpentSol
}
```

The base class increments `signedTrades` on success; you own `positions` and `pnlPct` (both surface in
the heartbeat).

---

## Lifecycle

The runtime mirrors the `agentd` contract the mesh expects:

| Method | When | Writes |
|--------|------|--------|
| `start()` | boot | ensures dataDir, reads config, calls `setup()`, marks running, first heartbeat |
| `runTick()` | every `intervalMs` | `scans++`, runs your `tick()`, writes a `running` heartbeat (errors caught + logged) |
| `stop(reason)` | SIGTERM/SIGINT/drain | `onDrain()` → `checkpoint()` → final `stopped` heartbeat → exit |
| `run()` | production entry | `start()` + the timer + signal handlers |

The runtime writes `<dataDir>/heartbeat.json` (state, uptime, scans, pnl, positions, signedTrades — the
node-host forwards it to the control plane) and appends to `<dataDir>/agent.log` via `this.log()`.

Everything is injectable (`fs`, `now`, `onExit`, `print`, `custody`), so you can unit-test an agent with
no timers, no real signer, and no `process.exit`.

---

## Local: paper (MockCustody) + self-custody (LocalKeypairCustody)

With no `CIRCUIT_SIGNER_URL` and no executor, the agent uses **`MockCustody`** — paper trading that
mirrors the signer's policy checks and returns the **same rejection codes**. So the exact same agent
behaves identically in dev and on the cloud:

```ts
// no signer, no executor → MockCustody (paper), with a policy you control:
const bot = new DipBot({ policy: { maxNotionalSol: 0.02, cooldownMs: 0 } });
await bot.start();
await bot.runTick();          // drive ticks by hand in tests
```

To trade **for real on hardware you control**, pass a self-custody executor — the agent then uses
**`LocalKeypairCustody`**, signing each `buy`/`sell` locally with your own keypair through the same
policy gate. It goes live when `CIRCUIT_AGENT_PAPER=0`:

```ts
import { makeWallet, walletTradeExecutor } from '@circuit/wallet';
const wallet = makeWallet();                                       // your keypair (CIRCUIT_WALLET / keyfile)
const bot = new DipBot({ executor: walletTradeExecutor(wallet) }); // → LocalKeypairCustody
```

> ⚠ Unlike the off-box signer or the vault, `LocalKeypairCustody` holds a **withdraw-capable key on the
> host** — use it only on a machine you control, never on the mesh (there the off-box signer or the
> non-custodial vault is the correct custody).

---

## Paying for inference vs. trading custody

A subtle but important rule: **the off-box custody wallet is `buy`/`sell`-only — it cannot pay for
inference or data.** Paying an x402 endpoint is a CIRC *transfer* to a treasury, which the signer will
not sign (no transfer verb). So:

- **Trading** uses the off-box custody wallet (`this.buy`/`this.sell`).
- **Paying for inference/data** uses a **separate, owner-funded payment wallet** you pass to the
  composition helpers:

  ```ts
  async tick() {
    const ai = this.inference({ wallet: this.payWallet });   // a normal PaymentWallet you fund
    const out = await ai.chat({ messages });                 // paid with payWallet, not custody
    if (signal(out)) await this.buy(mint, 0.01);             // traded via off-box custody
  }
  ```

Or skip payment with `this.inference({ internalKey })` / free data endpoints. Keeping the two wallets
separate is what lets an agent *think* on a paid model while its *funds* stay un-stealable.

---

## Scaffold a project

```bash
npx circuit-agent new my-bot         # → my-bot/{package.json, agent.ts, config.json, README.md}
cd my-bot && npm install && npm start # paper mode — identical semantics to the cloud
```

Programmatically: `scaffold(name)` returns a path→content map; `writeScaffold(name, dir)` writes it.

---

## Hosting

`@circuit/agent` is what you *write the agent with*. Deploying it to the mesh —
`create`/`start`/`stop`, placement, the operator's node-host — lives in
[circuit-cli](https://github.com/Circuit-LLM/circuit-cli) (`circuit agent …`) and
[circuit-agent-cloud](https://github.com/Circuit-LLM/circuit-agent-cloud). The runtime's job is to make
your agent *speak the contract* those expect; the cloud schedules it, opens the custody session, and
forwards your heartbeats.

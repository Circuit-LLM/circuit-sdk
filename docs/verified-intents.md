# Verified Intents

Your agent runs on **someone else's CPU**. Off-box custody already keeps the host from ever *draining*
the wallet — the signer's only verbs are `buy` and `sell`. But that still leaves one gap: a hostile host
could submit an *in-policy* `buy`/`sell` **of its own choosing**, griefing your agent within your caps.

**Verified Intents close that gap — in software, on any CPU.** The idea is *validate, don't isolate*: the
off-box signer signs a trade only if your **committed decision rule**, re-run on **authenticated inputs**,
produces *exactly that trade*. The host fully controls the agent process and still can't get a trade
signed that your rule + the real data don't justify.

> This is the software path. The hardware path — a TEE that attests the whole agent, for strategies the
> signer *can't* re-check — is [SEALED_AGENTS.md](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/SEALED_AGENTS.md).
> Full threat model + spec: [VERIFIED_INTENTS.md](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/VERIFIED_INTENTS.md).

---

## How it works

```
   agent (untrusted host)                          signer (off-box, trusted)
   ─────────────────────                           ─────────────────────────
   1. gather AUTHENTICATED inputs                   for the submitted intent:
      • signed price   ◄── data-api                   a. verify each evidence (sig + freshness + nonce)
      • signed verdict ◄── inference gateway           b. bind inputs → the values evidence proves
      • zktls proof    ◄── TLSNotary/Reclaim           c. RE-RUN your rule(inputs) — must equal the intent
   2. rule(inputs) → buy/sell  (or no signal)        d. policy caps (notional/daily/cooldown)
   3. submit { intent, rule, inputs, evidence }  ─►  e. sign  ── only if a–d all pass
```

If the host tampers with the trade, the inputs, or the evidence, step **c** (or **a**) fails and the
signer rejects it — `decision-unjustified`, `evidence-invalid`, `input-mismatch`, `evidence-stale`, …

---

## What it protects (and what it doesn't)

| Tier | Your strategy | Property |
|---|---|---|
| **T1 — deterministic rule** | `buy if price < X and bounce > Y` over signed/zkTLS inputs | **fully prevented** — the signer re-runs the rule; the host can't forge |
| **T2 — signed AI** | decision = a **signed inference verdict** from Circuit's DLLM over signed inputs | **prevented**, *modulo trusting the mesh's signature* — the host can't fake the verdict |
| **T3 — opaque** | a black box the signer can't re-run or get signed | **not prevented** by Verified Intents — use a [TEE](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/SEALED_AGENTS.md), or fall back to caps + deterrence |

Always true (verified or not): **no drain** (off-box `buy`/`sell`-only) and **at-most-one** (the epoch
fence). Verified Intents add **no forgery** for T1/T2. Honest residuals: a host can still *withhold* a
valid trade or pick *when* among genuinely-justified moments, and T3 stays uncheckable in software.

---

## 1. Write a decision rule

A rule is a small, deterministic program the signer can re-run: conditions over named inputs → an intent.

```ts
import type { Rule } from '@circuit/sdk';

const dipRule: Rule = {
  id: 'dip-v1',
  when: [
    { input: 'price1hChangePct', op: '<', value: 0 },   // dipped over the hour
    { input: 'bounce5mPct',      op: '>=', value: 1.5 }, // bouncing now
  ],
  then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
  requires: ['price1hChangePct', 'bounce5mPct'],         // inputs that MUST be backed by evidence
};
```

- `when` — every condition must hold (AND). Ops: `< <= > >= == !=`.
- `then` — `kind: 'buy' | 'sell'`; the token is a literal (`token`) or pulled from an input (`tokenInput`);
  size is `sizeSol` (literal) or `sizeInput`.
- `requires` — the input keys the signer insists are proven by evidence. (Anything not in `requires` can
  inform the rule but isn't independently verified — keep the trade-deciding inputs in here.)

`evaluateRule(rule, inputs)` returns the `Intent` or `null` (no signal). It's pure — the same function the
signer runs, so what fires locally is what gets signed.

---

## 2. Gather authenticated inputs (evidence)

Evidence is data the signer can check came from a source it trusts. Three kinds:

**Signed quote** — first-party Circuit data, signed by the data-API (`?signed=1`):

```ts
import { Data } from '@circuit/sdk';

const data = new Data({ wallet });
const acceptedKeys = { [(await data.signingKey()).key]: 'data' as const };

const quote = await data.getSigned('/api/token-price', { mint }, { acceptedKeys });
// quote: { kind:'signed-quote', path, data:{ price1hChangePct, bounce5mPct, mint }, ts, nonce, key, sig }
```

**Inference receipt** — a signed AI verdict from the DLLM gateway (turns "the model said BUY" into a
checkable input):

```ts
import { Inference } from '@circuit/sdk';

const inf = new Inference({ wallet });
const infKeys = { [(await inf.signingKey()).key]: 'inference' as const };

const { receipt } = await inf.chatVerified(
  { messages: [{ role: 'user', content: `${ctx} — answer BUY or SELL only.` }] },
  { acceptedKeys: infKeys },
);
// receipt.verdict === 'BUY'  → a rule can require `{ input: 'verdict', op: '==', value: 'BUY' }`
```

**zkTLS proof** — third-party data (an exchange API) proven authentic without trusting the host. Slower;
use it only for feeds Circuit doesn't serve. See the [spec §3](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/VERIFIED_INTENTS.md)
for TLSNotary vs Reclaim and the mandatory freshness binding.

---

## 3. Trade — the agent path

In verified mode, give the agent the rule + the keys it trusts; then call `verifiedTrade(inputs, evidence)`.
It evaluates the rule locally, and if it fires, submits `{ intent, rule, inputs, evidence }` to custody.

```ts
import { CircuitAgent } from '@circuit/sdk';

class DipBot extends CircuitAgent {
  async tick() {
    const mint = await this.pick();                       // your candidate selection
    const quote = await this.data().getSigned('/api/token-price', { mint }, { acceptedKeys: this.keys });

    const inputs = { ...quote.data, mint };               // values the rule reads
    const r = await this.verifiedTrade(inputs, [quote]);  // null = rule didn't fire; else signed result
    if (r?.ok) this.log(`bought ${mint} — verified (${r.code})`);
  }
}

new DipBot({
  rule: dipRule,
  acceptedKeys: this.keys,                                // { '<data pubkey>': 'data', '<inf pubkey>': 'inference' }
}).run();
```

Locally (no signer) `MockCustody` runs the **same decision gate**, so a verified agent behaves identically
in dev and on the cloud. The signer rejects anything the rule + inputs don't justify — so even your own
tampered build can't push a forged trade.

---

## 4. Enforce it on the cloud

Committing a rule makes it *available*; `requireVerifiedIntent` makes it *mandatory* — the signer then
refuses any plain (unverified) intent.

```bash
# rule.json = { "rule": { … }, "acceptedKeys": { "<pubkey>": "data" } }
circuit agent create dipbot --cloud --rule rule.json --require-verified
circuit agent verify dipbot          # shows the committed rule, what's enforced, trusted keys
```

The control plane forwards the rule to the off-box signer at provisioning; from then on every trade for
that agent must pass the gate.

---

## Reject codes

| Code | Meaning |
|---|---|
| `verified` | accepted — rule + authenticated inputs produced this exact trade |
| `unknown-rule` | the submitted `rule` id isn't the one committed for this agent |
| `evidence-invalid` | a signature/proof didn't verify (tampered or wrong key) |
| `evidence-untrusted-key` | signed by a key not in `acceptedKeys` for that class |
| `evidence-stale` | outside the freshness window (replay of old-but-real data) |
| `evidence-replay` | a nonce was reused |
| `input-mismatch` | a `requires` input isn't backed by the evidence's proven value |
| `decision-unjustified` | the rule, re-run on the inputs, did **not** produce this trade |

---

## See also

- [agents.md](agents.md) — the agent runtime + off-box custody (what a host can and can't do)
- [`@circuit/attest`](packages.md) — the sign/verify/rule/gate primitives (the keystone)
- [VERIFIED_INTENTS.md](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/VERIFIED_INTENTS.md) — full threat model, zkTLS deep-dive, milestones
- [SEALED_AGENTS.md](https://github.com/Circuit-LLM/circuit-agent-cloud/blob/main/docs/SEALED_AGENTS.md) — the TEE path for opaque strategies

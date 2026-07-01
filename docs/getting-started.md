# Getting started

The Circuit SDK lets you build on the [Circuit](https://circuitllm.xyz) decentralized intelligence
network from TypeScript or Python — paid inference, on-chain data, CIRC wallet ops, and autonomous
agents. There are **no API keys**: a Solana wallet is your account and your meter, and every paid call
is a CIRC micropayment over [x402](./x402.md).

- [Requirements](#requirements)
- [Install](#install)
- [Connect a wallet](#connect-a-wallet)
- [Configuration (endpoints & RPC)](#configuration-endpoints--rpc)
- [Your first calls (TypeScript)](#your-first-calls-typescript)
- [Your first calls (Python)](#your-first-calls-python)
- [What needs a wallet (and what doesn't)](#what-needs-a-wallet-and-what-doesnt)
- [Troubleshooting](#troubleshooting)
- [Next steps](#next-steps)

---

## Requirements

| What | Why |
|------|-----|
| **Node.js ≥ 22** | The TypeScript SDK (uses native `fetch` + type stripping for dev) |
| **Python ≥ 3.10** | Only if you use `circuit-py` |
| **A Solana wallet** | Signs CIRC payments (and sends/swaps with `@circuit-llm/wallet`) |
| **CIRC + a little SOL** | Inference costs ~$0.03 in CIRC per call; SOL covers transaction fees |

> **CIRC token CA:** `8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump` — [buy on Pump.fun](https://pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump).

---

## Install

Install the meta-package for everything, or only the packages you need:

```bash
npm install @circuit-llm/sdk          # everything, one import
# or pick only what you need:
npm install @circuit-llm/inference @circuit-llm/wallet @circuit-llm/x402
```

Python:

```bash
pip install circuit-py            # stdlib-only consume client (once published)
```

> `circuit-py` isn't on PyPI yet — until the first release, install it from this repo:
> `pip install ./circuit-py`.

From this repo (development), everything is wired through npm workspaces — `npm install` at the root
links all packages and you can `import` them directly.

---

## Connect a wallet

`@circuit-llm/wallet` loads a Solana keypair, in this order:

1. **`CIRCUIT_WALLET`** — a base58 secret key in the environment (nothing written to disk)
2. an explicit keypair you pass to `makeWallet({ keypair })`

```ts
import { makeWallet, generateKeypair, keypairFromSecret } from '@circuit-llm/wallet';

const wallet = makeWallet();                         // from CIRCUIT_WALLET
// or:
const wallet2 = makeWallet({ keypair: keypairFromSecret(process.env.MY_KEY!) });

console.log(wallet.address);
console.log('SOL :', await wallet.solBalance());
console.log('CIRC:', await wallet.circBalance());
```

A `Wallet` implements the `PaymentWallet` interface (`sendCirc`), so it drops straight into any client
that pays — `Inference`, `Data`, or a raw `X402Client`.

> Your secret key is never printed or logged. For read-only use, construct a client with **no** wallet
> — free endpoints and the mesh topology work without one.

> **No wallet yet?** The `circuit` CLI can make one: `circuit wallet generate` (a fresh keypair with a
> one-time secret reveal) or `circuit wallet import`. Reveal the base58 secret and set it as
> `CIRCUIT_WALLET`. See [the CLI](./cli.md).

---

## Configuration (endpoints & RPC)

Everything works out of the box against Circuit's live endpoints — but two things are worth setting
before you run at any volume.

**Use your own Solana RPC.** The default is the public `api.mainnet-beta.solana.com`, which rate-limits;
under real load, payments start failing. Point the wallet at your own provider:

```ts
const wallet = makeWallet({ rpcUrl: 'https://your-rpc-provider' });
```

**Environment variables the SDK reads:**

| Variable | Read by | Purpose |
|----------|---------|---------|
| `CIRCUIT_WALLET` | `makeWallet()` | base58 secret key — loaded automatically, nothing written to disk |
| `CIRCUIT_RPC_URL` | `configFromEnv()` | Solana RPC for payments + on-chain reads |
| `CIRCUIT_INFERENCE_URL` | `configFromEnv()` | override the inference gateway |
| `CIRCUIT_DATA_URL` | `configFromEnv()` | override the data API |
| `JUPITER_API_KEY` | `makeWallet()` | lifts the swap rate limit (the free Jupiter endpoint throttles hard) |

`CIRCUIT_WALLET` is picked up on its own. The rest flow through `configFromEnv()` — build a config once
and pass it everywhere (anything unset falls back to the live defaults):

```ts
import { makeWallet, Inference, Data, defineConfig, configFromEnv } from '@circuit-llm/sdk';

const config = defineConfig(configFromEnv());        // env → a full config
const wallet = makeWallet({ config });               // your RPC for payments
const ai     = new Inference({ wallet, config });
const data   = new Data({ wallet, config });
```

Or override a single endpoint inline — handy for pointing at a local gateway:

```ts
const ai = new Inference({ wallet, baseUrl: 'http://localhost:8000/v1' });
```

---

## Your first calls (TypeScript)

```ts
import { makeWallet, Inference, Data } from '@circuit-llm/sdk';

const wallet = makeWallet();
const ai   = new Inference({ wallet });
const data = new Data({ wallet });

// Non-streaming chat — returns content, token usage, and the payment receipt.
const res = await ai.chat({ messages: [{ role: 'user', content: 'what is a falling knife?' }] });
console.log(res.content);
console.log('paid tx:', res.paymentTx);

// Streaming — yields token deltas; the generator returns the final result.
for await (const tok of ai.chatStream({ messages: [{ role: 'user', content: 'count to 5' }] }))
  process.stdout.write(tok);

// Paid market data — one call.
const price = await data.tokenPrice('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
console.log(price);
```

Cap your spend so a misquoting server can't drain the wallet:

```ts
const ai = new Inference({ wallet, maxSpendRaw: 500_000_000n });   // ≤ 500 CIRC per call
```

Approve each payment interactively:

```ts
const ai = new Inference({ wallet, onPay: (q) => console.log(`paying ${q.amountDisplay}`) });
```

---

## Your first calls (Python)

`circuit-py` mirrors the consume surface. Bring your own `PaymentWallet` — any object with
`send_circ(recipient, amount_raw) -> str` (e.g. built on [`solders`](https://github.com/kevinheavey/solders)).

```python
from circuit import Inference, Data

class MyWallet:
    def send_circ(self, recipient: str, amount_raw: int) -> str:
        ...  # build + send a CIRC Token-2022 transfer, return the tx signature

ai = Inference(wallet=MyWallet())
out = ai.chat([{"role": "user", "content": "hi"}])
print(out["content"], "· paid", out["payment_tx"])

data = Data(wallet=MyWallet())
print(data.token_price("8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump"))
```

The HTTP transport is injectable (`transport=...`) for testing without a network — see the bundled
`tests/`.

---

## What needs a wallet (and what doesn't)

| Capability | Wallet? |
|------------|:------:|
| Inference (`chat`, `chatStream`) | **yes** (paid) |
| Paid data (`tokenPrice`, `walletAnalytics`, …) | **yes** (paid) |
| Free data (`quote`, `prices`, `status`, `probe`) | no |
| Mesh topology / health (`@circuit-llm/node`) | no |
| Stake + CIRC reads (`@circuit-llm/onchain`) | no |
| Sends / swaps (`@circuit-llm/wallet`) | **yes** (a keypair) |

Trusted/co-located callers can skip payment entirely with an internal key:

```ts
const ai = new Inference({ internalKey: process.env.CIRCUIT_INTERNAL_KEY });   // no wallet, no 402
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `No wallet loaded — pass a keypair or set CIRCUIT_WALLET` | No key available | Set `CIRCUIT_WALLET`, or pass `makeWallet({ keypair })` |
| Calls hang, time out, or fail under load (+ a startup warning about the public RPC) | The default public RPC is rate-limiting — the SDK warns you when you're on it | Set your own RPC — see [Configuration](#configuration-endpoints--rpc) |
| `SpendCapError` | A quote exceeded `maxSpendRaw` | Raise the cap if the price is legitimate; otherwise it just protected you |
| `PaymentRequiredError` after a payment | The transfer didn't confirm (RPC lag, or no SOL for fees) | Keep a little SOL for fees; use a reliable RPC |
| `InsufficientFundsError` | Wallet is short on CIRC (or SOL for fees) — the error names which token and the shortfall | Fund it: CIRC via [Pump.fun](https://pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump), plus a little SOL for fees |
| `Jupiter quote 429` / `Jupiter swap 429` | The free Jupiter endpoint is rate-limiting your IP | Set `JUPITER_API_KEY` (or `makeWallet({ jupiterApiKey })`) to use the keyed host |
| `chat` returns empty `content` | Gateway/model hiccup | Retry; run `circuit status doctor` (CLI) to check the mesh |

---

## Next steps

- **Run the CLI** — `npm run cli` opens the interactive `circuit` console (it lives in `apps/cli`, built
  on this SDK — chat, wallet, data, swarm, and agent hosting from the terminal).
- **[x402](./x402.md)** — how the payment loop works, and how to gate your own endpoints with it.
- **[Packages](./packages.md)** — the full API of every package.
- **[Agents](./agents.md)** — write an autonomous agent with off-box custody.
- **[Contribute a node](./contributing-a-node.md)** — join the mesh from code.

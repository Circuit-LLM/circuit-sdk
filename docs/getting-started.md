# Getting started

The Circuit SDK lets you build on the [Circuit](https://circuitllm.xyz) decentralized intelligence
network from TypeScript or Python — paid inference, on-chain data, CIRC wallet ops, and autonomous
agents. There are **no API keys**: a Solana wallet is your account and your meter, and every paid call
is a CIRC micropayment over [x402](./x402.md).

- [Requirements](#requirements)
- [Install](#install)
- [Connect a wallet](#connect-a-wallet)
- [Your first calls (TypeScript)](#your-first-calls-typescript)
- [Your first calls (Python)](#your-first-calls-python)
- [What needs a wallet (and what doesn't)](#what-needs-a-wallet-and-what-doesnt)
- [Next steps](#next-steps)

---

## Requirements

| What | Why |
|------|-----|
| **Node.js ≥ 22** | The TypeScript SDK (uses native `fetch` + type stripping for dev) |
| **Python ≥ 3.10** | Only if you use `circuit-py` |
| **A Solana wallet** | Signs CIRC payments (and sends/swaps with `@circuit/wallet`) |
| **CIRC + a little SOL** | Inference costs ~$0.03 in CIRC per call; SOL covers transaction fees |

> **CIRC token CA:** `8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump` — [buy on Pump.fun](https://pump.fun/coin/8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump).

---

## Install

Install the meta-package for everything, or only the packages you need:

```bash
npm install @circuit/sdk          # everything, one import
# or pick only what you need:
npm install @circuit/inference @circuit/wallet @circuit/x402
```

Python:

```bash
pip install circuit-py            # stdlib-only consume client
```

From this repo (development), everything is wired through npm workspaces — `npm install` at the root
links all packages and you can `import` them directly.

---

## Connect a wallet

`@circuit/wallet` loads a Solana keypair, in this order:

1. **`CIRCUIT_WALLET`** — a base58 secret key in the environment (nothing written to disk)
2. an explicit keypair you pass to `makeWallet({ keypair })`

```ts
import { makeWallet, generateKeypair, keypairFromSecret } from '@circuit/wallet';

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

---

## Your first calls (TypeScript)

```ts
import { makeWallet, Inference, Data } from '@circuit/sdk';

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
| Mesh topology / health (`@circuit/node`) | no |
| Stake + CIRC reads (`@circuit/onchain`) | no |
| Sends / swaps (`@circuit/wallet`) | **yes** (a keypair) |

Trusted/co-located callers can skip payment entirely with an internal key:

```ts
const ai = new Inference({ internalKey: process.env.CIRCUIT_INTERNAL_KEY });   // no wallet, no 402
```

---

## Next steps

- **Run the CLI** — `npm run cli` opens the interactive `circuit` console (it lives in `apps/cli`, built
  on this SDK — chat, wallet, data, swarm, and agent hosting from the terminal).
- **[x402](./x402.md)** — how the payment loop works, and how to gate your own endpoints with it.
- **[Packages](./packages.md)** — the full API of every package.
- **[Agents](./agents.md)** — write an autonomous agent with off-box custody.
- **[Contribute a node](./contributing-a-node.md)** — join the mesh from code.

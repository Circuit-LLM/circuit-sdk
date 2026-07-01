# @circuit-llm/sdk

> The batteries-included meta-package. One install, one import — re-exports the whole Circuit SDK: `core`, `x402`, `inference`, `data`, `wallet`, `agent`, `node`, `onchain`, and the `attest` primitives.

The front door to the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Getting started →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/getting-started.md)

## Install

```bash
npm install @circuit-llm/sdk
```

## Usage

```ts
import { makeWallet, Inference, Data } from '@circuit-llm/sdk';

const wallet = makeWallet();                                   // from CIRCUIT_WALLET

const ai = new Inference({ wallet });
const reply = await ai.chat({ messages: [{ role: 'user', content: 'hi' }] });

const data = new Data({ wallet });
const price = await data.tokenPrice('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
```

Want a smaller footprint? Install only what you need — every surface is also its own `@circuit-llm/*` package. Full map: **[packages](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)**.

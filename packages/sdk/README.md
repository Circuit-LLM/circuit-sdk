# @circuit-llm/sdk

[![npm](https://img.shields.io/npm/v/@circuit-llm/sdk?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/sdk)

> The batteries-included meta-package. One install, one import — re-exports the whole Circuit SDK: `core`, `x402`, `inference`, `models`, `data`, `wallet`, `agent`, `node`, `onchain`, and the `attest` primitives.

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

**Hosted models** — reach GPT / Claude / Grok / … through Circuit's prepaid, OpenAI-compatible gateway (buy credits with USDC/SOL/CIRC, mint a key, then chat):

```ts
import { Models } from '@circuit-llm/sdk';

const models = new Models({ apiKey: process.env.CIRCUIT_MODELS_KEY, model: 'openai/gpt-4o-mini' });
const { content } = await models.chat({ messages: [{ role: 'user', content: 'hi' }] });
// buying credits + minting the key is wallet-signed: new Models({ wallet }).buy('SOL', 5) → .issueKey()
```

Want a smaller footprint? Install only what you need — every surface is also its own `@circuit-llm/*` package. Full map: **[packages](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)**.

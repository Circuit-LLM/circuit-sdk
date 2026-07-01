# @circuit/inference

> OpenAI-compatible client for Circuit's decentralized 72B, served across a mesh of independent GPUs and **paid per request in CIRC** over x402.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Getting started →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/getting-started.md)

## Install

```bash
npm install @circuit/inference @circuit/wallet
```

## Usage

```ts
import { makeWallet } from '@circuit/wallet';
import { Inference } from '@circuit/inference';

const ai = new Inference({ wallet: makeWallet() });   // wallet from CIRCUIT_WALLET
const res = await ai.chat({ messages: [{ role: 'user', content: 'what is a falling knife?' }] });
console.log(res.content);
```

- `chat(params)` — completion, paid automatically per call.
- `chatVerified(params, { acceptedKeys })` — returns a **signed inference receipt** for [Verified Intents](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/verified-intents.md).
- `listModels()`, `signingKey()`.

Cap spend per call: `new Inference({ wallet, maxSpendRaw: 500_000_000n })`.

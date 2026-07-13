# @circuit-llm/models

Client for the Circuit **models gateway** that powers **[circuitllm.xyz/models](https://circuitllm.xyz/models)** —
a pay-as-you-go, **OpenAI-compatible** reseller of OpenRouter, paid in Solana crypto against a prepaid USD
ledger.

Three things, only the first of which any other SDK can do:

- **chat** — call the metered OpenAI-compatible API with a `sk-circuit-` key
- **account / key** — issue or rotate your `sk-circuit-` key (wallet-signature gated)
- **purchase** — buy USD credits with **USDC / SOL / CIRC** (`build → sign+send → verify`)

> Chat is plain OpenAI-compatible, so the official OpenAI SDK works too — point it at `models.openaiBaseUrl`
> with your `sk-circuit-` key. This package adds the Circuit-specific parts (buying credits, minting keys)
> that no third-party SDK covers, plus a convenience chat client.
>
> This is a **separate service** from [`@circuit-llm/inference`](../inference): that pays the DLLM mesh
> per call in CIRC via x402; this debits a prepaid balance behind a Bearer key.

## Buy credits and mint a key

```ts
import { makeWallet } from '@circuit-llm/wallet';
import { Models } from '@circuit-llm/models';

const wallet = makeWallet();                 // loads CIRCUIT_WALLET
const models = new Models({ wallet });

// Top up $5 of credits with SOL (build → sign+send → poll until confirmed).
const receipt = await models.buy('SOL', 5);
console.log('balance now $' + receipt.balanceUsd);

// Issue (or rotate) the OpenAI-compatible key. Shown once.
const { circuitKey, base_url } = await models.issueKey();
console.log(circuitKey, base_url);           // sk-circuit-…  https://circuitllm.xyz/api/v1
```

## Chat

```ts
const models = new Models({ apiKey: process.env.CIRCUIT_MODELS_KEY, model: 'openai/gpt-4o-mini' });

const { content } = await models.chat({ messages: [{ role: 'user', content: 'hi' }] });

for await (const delta of models.chatStream({ messages: [{ role: 'user', content: 'stream this' }] })) {
  process.stdout.write(delta);
}
```

Or hand the base URL to the OpenAI SDK — no Circuit code in the hot path:

```ts
import OpenAI from 'openai';
const client = new OpenAI({ baseURL: models.openaiBaseUrl, apiKey: circuitKey });
```

## API

| Method | Needs | Does |
| --- | --- | --- |
| `catalog()` · `listModelIds()` · `stats()` | — | model list (with markup) · ids · usage totals |
| `account(address?)` | — | balance + key status |
| `issueKey()` | wallet | issue/rotate the `sk-circuit-` key (signed) |
| `quote(token, usd)` | — | how many tokens a USD amount buys now |
| `buildPurchase` · `verifyPurchase` | wallet | low-level credit purchase steps |
| `buy(token, usd, opts?)` | wallet | build → sign+send → verify, one call |
| `chat` · `chatStream` | apiKey | metered OpenAI-compatible completion |
| `openaiBaseUrl` | — | base URL for the OpenAI SDK |

`token` is `'USDC' | 'SOL' | 'CIRC'`. Non-2xx responses throw `ModelsError` (`.status`, `.body`).

## Config

`new Models({ wallet?, apiKey?, model?, baseUrl?, fetchImpl? })` — `apiKey` falls back to `CIRCUIT_MODELS_KEY`;
`baseUrl` defaults to `https://circuitllm.xyz/api`.

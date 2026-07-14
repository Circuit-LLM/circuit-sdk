# @circuit-llm/plugins

[![npm](https://img.shields.io/npm/v/@circuit-llm/plugins?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/plugins)

> Drop-in adapters that give **any agent framework** access to the Circuit Data API — live Solana market and on-chain data (prices, token security, holders, market regime, wallet analytics), paid per call in **CIRC via x402**. Free-tier endpoints work with no wallet.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Packages →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)

One dependency turns an agent into a Circuit data consumer. Same catalog, three surfaces.

## Install

```bash
npm i @circuit-llm/plugins
```

## ElizaOS

```ts
import { circuitPlugin } from '@circuit-llm/plugins/eliza';

const runtime = new AgentRuntime({
  plugins: [
    circuitPlugin({ tier: 'free' }),          // free endpoints, no wallet needed
    // circuitPlugin({ tier: 'all', wallet }), // + paid endpoints (x402 CIRC)
  ],
});
```

Each Circuit endpoint becomes an Eliza action (`CIRCUIT_TOKEN_PRICE`, `CIRCUIT_TOKEN_INFO`, …).

## Solana Agent Kit

```ts
import { circuitAgentKitActions } from '@circuit-llm/plugins/agent-kit';

const actions = circuitAgentKitActions({ tier: 'free' });
// register each with your SolanaAgentKit instance or LangChain tool list
```

## Any framework (neutral catalog)

```ts
import { circuitActions } from '@circuit-llm/plugins';

const { data, actions } = circuitActions({ tier: 'all', wallet });
const result = await actions.find(a => a.name === 'circuit_token_info')!
  .run(data, { mint: '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump' });
```

## Tiers & payment

| `tier`  | What's exposed | Wallet |
|---------|----------------|--------|
| `free` (default) | Endpoints that cost no CIRC (price, trending, market regime, new tokens) | not required |
| `all`   | Full catalog — paid endpoints spend micro-CIRC per call via x402 | required (`wallet` + budget) |

Payment is handled by [`@circuit-llm/data`](https://www.npmjs.com/package/@circuit-llm/data):
a paid endpoint answers `402`, the client pays CIRC to the Circuit treasury, and retries with
the receipt. Bound spend with `maxSpendRaw` / `maxTotalSpendRaw` and pin the recipient with
`allowedRecipients`.

## Adding endpoints

The action catalog lives in one file (`src/actions.ts`). Add an entry there and it appears in
the ElizaOS plugin, the Agent Kit actions, and the neutral catalog automatically.

MIT · part of the [Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk).

# @circuit/data

> Typed client for the Circuit Data API — market and on-chain intelligence (prices, liquidity, holders, trending, security), **paid per call in CIRC** over x402.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Packages →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)

## Install

```bash
npm install @circuit/data @circuit/wallet
```

## Usage

```ts
import { makeWallet } from '@circuit/wallet';
import { Data } from '@circuit/data';

const data = new Data({ wallet: makeWallet() });
const price = await data.tokenPrice('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
const trending = await data.tokenTrending();
```

Typed helpers for 40+ endpoints (`tokenPrice`, `tokenInfo`, `tokenHolders`, `tokenSecurity`, `scan`, …) plus a generic `get(path, query)`. `getSigned(...)` returns a **signed quote** for [Verified Intents](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/verified-intents.md). Built-in per-call and total spend caps.

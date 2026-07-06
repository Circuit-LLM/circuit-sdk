# @circuit-llm/onchain

[![npm](https://img.shields.io/npm/v/@circuit-llm/onchain?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/onchain)

> Read Circuit's on-chain state over **pure JSON-RPC** — StakePoint stake verification, CIRC balances, and the mesh registry — with no `@solana/web3.js` dependency.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Contribute a node →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/contributing-a-node.md)

## Install

```bash
npm install @circuit-llm/onchain
```

## Usage

```ts
import { verifyStake, circBalance } from '@circuit-llm/onchain';

const staked = await verifyStake(wallet, pool, 100_000, { rpcUrl });   // ≥ 100k CIRC staked?
const circ = await circBalance(address, { rpcUrl });
```

Also reads the on-chain mesh registry (`getMeshConfig`, `getNode`, `getNodes`) and stake positions (`getStakePositions`). Thin, dependency-light, and browser-friendly.

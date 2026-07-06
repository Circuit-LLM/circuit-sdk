# @circuit-llm/wallet

[![npm](https://img.shields.io/npm/v/@circuit-llm/wallet?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/wallet)

> A Solana wallet for the Circuit network: SOL + CIRC (Token-2022) balances, transfers, and Jupiter swaps — and the concrete `PaymentWallet` that powers x402.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Packages →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)

## Install

```bash
npm install @circuit-llm/wallet
```

## Usage

```ts
import { makeWallet, keypairFromSecret } from '@circuit-llm/wallet';

const wallet = makeWallet();                                  // from CIRCUIT_WALLET
// const wallet = makeWallet({ keypair: keypairFromSecret(secret) });

await wallet.solBalance();
await wallet.circBalance();
await wallet.sendCirc(recipient, 1_000_000n);                 // (to, amountRaw) — base units, 6 decimals
await wallet.swap(inputMint, outputMint, amount);            // (inMint, outMint, amount) via Jupiter
```

> Swaps use Jupiter's free endpoint, which rate-limits hard (`429`). For real usage, pass a Jupiter API key — `makeWallet({ jupiterApiKey })` or the `JUPITER_API_KEY` env var — to use the keyed host.

Implements `@circuit-llm/x402`'s `PaymentWallet`, so it drops straight into `Inference` / `Data`. Multi-RPC failover is built in; an underfunded send surfaces as a typed **`InsufficientFundsError`** (which token, and the shortfall) instead of an opaque chain error, and the wallet warns once if it's on the rate-limited default public RPC — pass `rpcUrl` (or set `CIRCUIT_RPC_URL`) to override. Also exports `generateKeypair`, `loadKeypairFromEnv`, `isValidAddress`, and `walletTradeExecutor` (self-custody trading for agents).

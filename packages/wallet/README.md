# @circuit/wallet

> A Solana wallet for the Circuit network: SOL + CIRC (Token-2022) balances, transfers, and Jupiter swaps — and the concrete `PaymentWallet` that powers x402.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Packages →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)

## Install

```bash
npm install @circuit/wallet
```

## Usage

```ts
import { makeWallet, keypairFromSecret } from '@circuit/wallet';

const wallet = makeWallet();                                  // from CIRCUIT_WALLET
// const wallet = makeWallet({ keypair: keypairFromSecret(secret) });

await wallet.solBalance();
await wallet.circBalance();
await wallet.sendCirc({ to, amountRaw });
await wallet.swap({ inputMint, outputMint, amount });         // via Jupiter Ultra
```

Implements `@circuit/x402`'s `PaymentWallet`, so it drops straight into `Inference` / `Data`. Multi-RPC failover built in. Also exports `generateKeypair`, `loadKeypairFromEnv`, `isValidAddress`, and `walletTradeExecutor` (self-custody trading for agents).

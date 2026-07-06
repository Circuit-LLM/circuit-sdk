# @circuit-llm/x402

[![npm](https://img.shields.io/npm/v/@circuit-llm/x402?color=cb3837&label=npm)](https://www.npmjs.com/package/@circuit-llm/x402)

> The payment spine of the Circuit network: pay any x402-gated endpoint in CIRC (client) and verify on-chain CIRC payments (server). **Zero runtime dependencies.**

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)** — every paid call in the ecosystem (inference, data) runs on this. [Full guide →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/x402.md)

## Install

```bash
npm install @circuit-llm/x402
```

## Pay (client)

```ts
import { X402Client } from '@circuit-llm/x402';

const client = new X402Client({ wallet });   // wallet: a PaymentWallet — see @circuit-llm/wallet
const res = await client.fetch('https://gateway.circuitllm.xyz/v1/chat/completions', {
  method: 'POST',
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
});
// On HTTP 402 it reads the CIRC price, pays on-chain, and retries with the tx signature — transparently.
```

## Verify (server)

```ts
import { verifyPaymentTx } from '@circuit-llm/x402';

const ok = await verifyPaymentTx(signature, { expectRaw, recipient, rpcUrl });
```

Built-in spend caps (`maxSpendRaw`, `maxTotalSpendRaw`), replay protection, and a CIRC/USD oracle. CIRC is a Token-2022 mint (`8fQ…pump`, 6 decimals).

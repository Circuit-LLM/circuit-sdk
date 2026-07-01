# @circuit-llm/attest

> The **Verified Intents** core: sign and verify authenticated inputs (signed first-party data, inference receipts, zkTLS), a safe decision-rule DSL, and the signer-side gate that re-derives a trade and rejects forgeries.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Verified Intents →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/verified-intents.md)

## Install

```bash
npm install @circuit-llm/attest
```

## Usage

```ts
import { evaluateRule } from '@circuit-llm/attest';

const rule = {
  id: 'dip-v1',
  when: [{ input: 'price1hChangePct', op: '<', value: 0 }],
  then: { kind: 'buy', tokenInput: 'mint', sizeSol: 0.01 },
  requires: ['price1hChangePct'],
};

const intent = evaluateRule(rule, inputs);   // the trade the rule produces, or null
// The off-box signer runs decisionGate(...) on AUTHENTICATED inputs and signs only if it matches.
```

The same `evaluateRule` runs locally and in the signer, so what fires in dev is what gets signed. Key exports: `signQuote` / `signInferenceReceipt` · `verifyEvidence` · `evaluateRule` · `decisionGate` · `sameIntent`.

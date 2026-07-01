# @circuit-llm/agent

> Write an autonomous on-chain agent (`CircuitAgent`) with **pluggable custody** — paper, self-custody, off-box signer, or the non-custodial on-chain vault. The same strategy runs in all four; the agent can only buy/sell, so funds can't leave.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Agents guide →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/agents.md)

## Install

```bash
npm install @circuit-llm/agent
```

## Usage

```ts
import { CircuitAgent, MockCustody } from '@circuit-llm/agent';

class DipBot extends CircuitAgent {
  async tick() {
    const mint = '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump';
    const q = await this.data().tokenPrice(mint);
    if (q.price1hChangePct < 0) await this.buy(mint, 0.01);   // paper or live — same code
  }
}

new DipBot({ custody: new MockCustody() }).run();             // MockCustody = paper trading
```

Custody backends: `MockCustody` (paper) · `LocalKeypairCustody` (self-custody) · `SignerCustody` (off-box mesh signer) · `VaultCustody` (on-chain vault — via [@circuit-llm/vault](https://github.com/Circuit-LLM/circuit-sdk/tree/main/packages/vault)). On an untrusted host, pair with **[Verified Intents](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/verified-intents.md)** so the host can't forge trades.

# @circuit-llm/core

> The tiny, zero-dependency foundation every Circuit package builds on: HTTP client, injectable config, ed25519 identity, owner-auth request signing, canonical serialization, and shared types.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Architecture →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/architecture.md)

## Install

```bash
npm install @circuit-llm/core
```

## Usage

```ts
import { defineConfig, generateIdentity, stableStringify } from '@circuit-llm/core';

const config = defineConfig({ gatewayUrl: 'https://gateway.circuitllm.xyz' });  // injectable, no globals
const id = generateIdentity();                                                  // ed25519 keypair
const canonical = stableStringify({ b: 2, a: 1 });                              // deterministic JSON for signing
```

Key exports: `defineConfig` · `configFromEnv` · `generateIdentity` / `loadOrCreateIdentity` · `stableStringify` (see [canonical serialization](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/canonical-serialization.md)) · `signRequest` / `verifyRequest` · `ownerAuthHeaders` / `verifyOwnerRequest` · CIRC constants. **Zero dependencies.**

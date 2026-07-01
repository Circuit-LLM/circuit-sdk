# @circuit/node

> Join and manage a Circuit mesh node from code: the inference-mesh control plane (register / ready / heartbeat) and the public node registry (announce / ping). The heavy GPU serving stays in the node image.

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Contribute a node →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/contributing-a-node.md)

## Install

```bash
npm install @circuit/node
```

## Usage

```ts
import { MeshControl, generateMeshIdentity } from '@circuit/node';

const identity = generateMeshIdentity();
const mesh = new MeshControl({ controlUrl: 'http://control:18932', identity });
const { assignment } = await mesh.register({
  endpoint: ['1.2.3.4', 5000],
  capacityLayers: 40,
  modelFp: 'qwen2.5-72b-awq',
});
await mesh.ready();   // …then heartbeat
```

Also: `NodeRegistry` (public announce/ping) and `signMeshBody` / `verifyMeshBody`. Pair with [@circuit/onchain](https://github.com/Circuit-LLM/circuit-sdk/tree/main/packages/onchain) to verify what's staked.

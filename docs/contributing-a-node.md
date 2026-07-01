# Contribute a node

The same SDK that *consumes* Circuit can *join* it. `@circuit-llm/node` gives you the control surface for a
mesh node from code; `@circuit-llm/onchain` reads stake and CIRC balances with no `@solana/web3.js`. The
heavy lifting — actually serving 72B layer slices on a GPU — stays in the node image; the SDK is the
**control plane** you talk to.

- [Two surfaces](#two-surfaces)
- [Join the inference mesh (MeshControl)](#join-the-inference-mesh-meshcontrol)
- [The public node registry (NodeRegistry)](#the-public-node-registry-noderegistry)
- [Read stake & balances (onchain)](#read-stake--balances-onchain)
- [Two identity schemes](#two-identity-schemes)

---

## Two surfaces

| Surface | Class | What it's for |
|---------|-------|---------------|
| **Inference-mesh control plane** | `MeshControl` | a GPU holder/orchestrator joining the DLLM mesh: register → get a slot → heartbeat |
| **Public node registry** | `NodeRegistry` | announcing a node on the network registry + discovering peers |

They use **different** signing schemes (see [below](#two-identity-schemes)).

---

## Join the inference mesh (MeshControl)

`MeshControl` speaks the `circuit-dllm` control plane: `register` (signed), then `ready`, `heartbeat`,
`drain`, plus read-only `topology`/`health`.

```ts
import { MeshControl, generateMeshIdentity } from '@circuit-llm/node';

const identity = generateMeshIdentity();          // raw-hex ed25519 — persist identity.seedHex
const mesh = new MeshControl({ controlUrl: 'http://control:18932', identity });

// Join: announce what you can serve; the control plane assigns a layer slot + a derived session key.
const { assignment, session_key, replication } = await mesh.register({
  endpoint: ['203.0.113.5', 5000],   // where the coordinator dials you
  capacityLayers: 40,
  modelFp: 'qwen2.5-72b-awq',
  payoutWallet: '<your CIRC payout address>',
});
console.log('serving layers', assignment);        // e.g. { start: 0, end: 40 }

// …load your slice, then:
await mesh.ready();

// Heartbeat on an interval; if the control plane forgot you (it restarted), re-register.
setInterval(async () => {
  const hb = await mesh.heartbeat();
  if (hb.registered === false) await mesh.register({ endpoint: ['203.0.113.5', 5000], capacityLayers: 40, modelFp: 'qwen2.5-72b-awq', loadedLayers: [assignment!.start, assignment!.end] });
}, 10_000);
```

- `register` is **signed** with your mesh identity; the control plane verifies you hold the key behind
  your `node_id`.
- Pass `loadedLayers` when re-registering so you reclaim the exact slot you already loaded.
- `orchestrator: true` registers a head-only orchestrator instead of a slice holder.
- Inspect the mesh anytime (no identity needed): `await mesh.topology()` → `{ slots, coverage_ok }`.

> Restarting the control plane never orphans nodes — your heartbeat sees `registered: false` and you
> re-register for your loaded slot. (This is exactly how the production node client stays attached.)

---

## The public node registry (NodeRegistry)

The network's public registry (`api.circuitllm.xyz`) for announcing a node and finding peers. Signed
with the **`@circuit-llm/core`** ed25519 identity (SPKI/base64, `X-Node-*` headers):

```ts
import { NodeRegistry } from '@circuit-llm/node';
import { generateIdentity, loadOrCreateIdentity } from '@circuit-llm/core';

const identity = await loadOrCreateIdentity('./data/identity.json');   // persistent
const reg = new NodeRegistry({ registryUrl: 'https://api.circuitllm.xyz', identity });

await reg.announce({ version: '0.1.0', shards: ['all'], region: 'na-east', apiPort: 19000 });
setInterval(() => reg.ping({ agentRunning: false }), 60_000);

const peers = await reg.getPeers({ shard: 'CHAIN_METRICS' });          // discover nodes
// on shutdown:
await reg.deregister();
```

---

## Read stake & balances (onchain)

`@circuit-llm/onchain` is pure JSON-RPC — give it an `rpcUrl` and it reads. No `@solana/web3.js`.

```ts
import { verifyStake, getStakePositions, circBalance } from '@circuit-llm/onchain';

const rpc = { rpcUrl: process.env.RPC_URL! };

// Is a wallet eligible? (StakePoint, summed across all positions, exact BigInt check)
const stake = await verifyStake(wallet, pool, 100_000, rpc);          // need ≥ 100k CIRC
if (stake.eligible) console.log(`staked ${stake.stakedAmount} CIRC across ${stake.positionCount} positions`);

// Raw positions (with lock status):
const positions = await getStakePositions(wallet, pool, rpc);

// CIRC balance of any wallet:
const bal = await circBalance(wallet, rpc);
```

`verifyStake` returns `{ eligible, stakedAmount, stakedRaw, positionCount, lockUntil, lockActive,
positions }`. Eligibility is computed in exact integer math; the float `stakedAmount` is for display.

---

## Two identity schemes

The ecosystem uses **two** ed25519 identities — don't conflate them:

| | `@circuit-llm/core` `Identity` | `@circuit-llm/node` `MeshIdentity` |
|---|---|---|
| Used by | the public node registry | the inference-mesh control plane |
| `nodeId` | SPKI/DER public key, **base64** | raw public key, **hex** (64 chars) |
| Signature | `X-Node-Id`/`-Signature`/`-Timestamp` headers; signs `canonicalPayload(nodeId, ts, body)` | `node_id` + `ts` stamped into the body; `sig` over compact sorted-JSON of body-minus-sig |
| Generate | `generateIdentity()` | `generateMeshIdentity()` |

The SDK reproduces each scheme exactly (verified against the live servers), and `verifyRequest` /
`verifyMeshBody` are the server-side counterparts if you're building a registry or control plane of your
own.

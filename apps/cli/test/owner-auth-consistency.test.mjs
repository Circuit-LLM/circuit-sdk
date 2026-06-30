// Cross-repo lock: headers the CLI signs MUST verify under circuit-agent-cloud's real owner-auth
// verifier (identical canonical message + Ed25519 + base58). Drift → the multi-tenant CP rejects the CLI.
import assert from 'node:assert';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const kp = Keypair.generate();
process.env.CIRCUIT_WALLET = bs58.encode(kp.secretKey);

const { ownerAuthHeaders } = await import('../src/services/owner-auth.js');
const { verifyOwnerRequest, NonceStore } = await import('/home/watchtower/circuit-agent-cloud/lib/owner-auth.js');

const body = { name: 'a-bot', spec: { workload: 'agentd' } };
const headers = ownerAuthHeaders('POST', '/v1/agents?ignored=1', body); // CLI strips the query when signing

const owner = verifyOwnerRequest(
  { method: 'POST', path: '/v1/agents', body, headers },
  { nonceStore: new NonceStore() },
);
assert.equal(owner, kp.publicKey.toBase58(), 'cloud verifier accepts the CLI signature for the wallet owner');

// a body tweak must break it
assert.throws(
  () => verifyOwnerRequest({ method: 'POST', path: '/v1/agents', body: { ...body, name: 'evil' }, headers }, { nonceStore: new NonceStore() }),
  /bad signature/,
);

console.log('CLI↔cloud owner-auth consistency: PASS');

// Cross-repo lock (docs/COMMAND_INBOX.md): a command the CLI signs with the owner wallet MUST
// verify under @circuit-llm/agent's verifyCommand — the SAME canonical bytes the sealed agent
// checks. If this drifts, every command the CLI sends is rejected at the agent. Also pins nextSeq.
import assert from 'node:assert';
import { Keypair } from '@solana/web3.js';
import { verifyCommand } from '@circuit-llm/agent';
import { buildSignedCommand, nextSeq } from '../src/services/agent-commands.js';

// buildSignedCommand → verifyCommand roundtrip, with an injected owner keypair (no keystore).
{
  const owner = Keypair.generate();
  const ownerPubkeyHex = Buffer.from(owner.publicKey.toBytes()).toString('hex');
  const cmd = buildSignedCommand('agent-xyz', { topN: 7 }, { keypair: owner, seq: 42, now: () => 1000 });

  assert.equal(cmd.agentId, 'agent-xyz');
  assert.equal(cmd.type, 'config-patch');
  assert.equal(cmd.seq, 42);
  assert.deepEqual(cmd.payload, { topN: 7 });
  assert.equal(cmd.expiresAt > cmd.createdAt, true, 'has a freshness window');
  assert.equal(verifyCommand(ownerPubkeyHex, cmd), true, 'CLI-signed command verifies at the agent');

  // a different wallet must NOT verify against the owner pubkey
  const other = Keypair.generate();
  const forged = buildSignedCommand('agent-xyz', { topN: 7 }, { keypair: other, seq: 42, now: () => 1000 });
  assert.equal(verifyCommand(ownerPubkeyHex, forged), false, 'a different signer is rejected');
}

// nextSeq: strictly above anything the CP has seen.
{
  assert.equal(nextSeq(null), 1, 'empty → 1');
  assert.equal(nextSeq({ ackedSeq: 5, pending: [{ seq: 8 }], recent: [{ seq: 6 }] }), 9, 'above the max seen');
  assert.equal(nextSeq({ ackedSeq: 0, pending: [], recent: [{ seq: 3 }] }), 4);
}

console.log('command-signing (CLI ↔ agent): OK');

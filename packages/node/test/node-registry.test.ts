import { test } from 'node:test';
import assert from 'node:assert';
import { NodeRegistry } from '../src/node-registry.ts';
import { generateIdentity, verifyRequest } from '@circuit/core';

function stub(status: number, body: unknown, capture?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    capture?.(url, init);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

test('announce posts a validly-signed request and returns the node record', async () => {
  const id = generateIdentity();
  let cap: { url: string; init: RequestInit } | undefined;
  const fetchImpl = stub(200, { node: { nodeId: id.nodeId, status: 'active' } }, (url, init) => (cap = { url, init: init! }));
  const reg = new NodeRegistry({ registryUrl: 'http://reg', identity: id, fetchImpl });

  const node = await reg.announce({ version: '0.1.0', region: 'na' });
  assert.equal((node as { status: string }).status, 'active');
  assert.equal(cap?.url, 'http://reg/api/network/nodes/announce');

  const headers = cap!.init.headers as Record<string, string>;
  assert.equal(headers['X-Node-Id'], id.nodeId);
  const body = JSON.parse(cap!.init.body as string);
  assert.equal(
    verifyRequest(
      { nodeId: headers['X-Node-Id']!, signature: headers['X-Node-Signature']!, timestamp: headers['X-Node-Timestamp']! },
      body,
    ),
    true,
  );
});

test('getPeers parses the nodes array', async () => {
  const id = generateIdentity();
  const reg = new NodeRegistry({ registryUrl: 'http://reg', identity: id, fetchImpl: stub(200, { nodes: [{ nodeId: 'x' }] }) });
  const peers = await reg.getPeers({ shard: 'CHAIN_METRICS' });
  assert.equal(peers.length, 1);
});

test('a non-2xx announce throws with the server error', async () => {
  const id = generateIdentity();
  const reg = new NodeRegistry({ registryUrl: 'http://reg', identity: id, fetchImpl: stub(403, { error: 'banned' }) });
  await assert.rejects(() => reg.announce({ version: '0.1.0' }), /banned/);
});

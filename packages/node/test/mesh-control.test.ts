import { test } from 'node:test';
import assert from 'node:assert';
import { MeshControl, MeshControlError } from '../src/mesh-control.ts';
import { generateMeshIdentity, verifyMeshBody } from '../src/mesh-identity.ts';

function stub(status: number, body: unknown, capture?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    capture?.(url, init);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

test('register signs the body and posts a verifiable request to /register', async () => {
  const id = generateMeshIdentity();
  let captured: { url: string; body: any } | undefined;
  const fetchImpl = stub(
    200,
    { assignment: { start: 0, end: 40 }, model_fp: 'm', session_key: 'k', coordinator: ['c', 1], replication: 1 },
    (url, init) => (captured = { url, body: JSON.parse(init!.body as string) }),
  );
  const mc = new MeshControl({ controlUrl: 'http://cp', identity: id, fetchImpl });
  const r = await mc.register({ endpoint: ['h', 5000], capacityLayers: 40, modelFp: 'm' });
  assert.equal(r.assignment?.end, 40);
  assert.equal(captured?.url, 'http://cp/register');
  assert.equal(captured?.body.node_id, id.nodeId);
  assert.equal(captured?.body.capacity_layers, 40);
  assert.equal(verifyMeshBody(captured!.body), true); // the wire body is validly signed
});

test('register requires an identity', async () => {
  const mc = new MeshControl({ controlUrl: 'http://cp', nodeId: 'abc', fetchImpl: stub(200, {}) });
  await assert.rejects(
    () => mc.register({ endpoint: ['h', 1], capacityLayers: 1, modelFp: 'm' }),
    /requires a MeshIdentity/,
  );
});

test('heartbeat returns the registered flag; ready/drain post just node_id', async () => {
  const id = generateMeshIdentity();
  let body: any;
  const fetchImpl = stub(200, { ok: true, registered: false }, (_u, init) => (body = JSON.parse(init!.body as string)));
  const mc = new MeshControl({ controlUrl: 'http://cp', identity: id, fetchImpl });
  const hb = await mc.heartbeat();
  assert.equal(hb.registered, false);
  assert.equal(body.node_id, id.nodeId);
});

test('topology is a GET; non-2xx surfaces as MeshControlError', async () => {
  const mc = new MeshControl({ controlUrl: 'http://cp', fetchImpl: stub(200, { slots: [], coverage_ok: true }) });
  assert.equal((await mc.topology()).coverage_ok, true);
  const mc2 = new MeshControl({ controlUrl: 'http://cp', identity: generateMeshIdentity(), fetchImpl: stub(503, { error: 'down' }) });
  await assert.rejects(() => mc2.ready(), MeshControlError);
});

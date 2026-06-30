// Cloud driver — drives an agent through the Control Plane API.
import fs from 'node:fs';
import { config } from '../../config.js';
import { ownerAuthHeaders } from '../owner-auth.js';

const base = () => config.endpoints.controlPlane.replace(/\/$/, '');

// Upload a published bundle's bytes to the shared store so ANY node can fetch it (not just the
// publisher's machine). Content-addressed + idempotent; owner-signed over the path (which holds the
// sha). The node re-verifies sha + signature + owner before running, so this transport is low-trust.
async function putBundle(sha256, filePath) {
  const bytes = fs.readFileSync(filePath);
  const p = `/v1/bundles/${sha256}.tgz`;
  const r = await fetch(base() + p, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip', ...ownerAuthHeaders('PUT', p, {}) },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(`bundle upload ${r.status}: ${e.error ?? ''}`.trim()); }
  return r.json();
}

async function api(method, p, body, timeoutMs = 10000) {
  const r = await fetch(base() + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.CIRCUIT_CLOUD_KEY ? { Authorization: `Bearer ${process.env.CIRCUIT_CLOUD_KEY}` } : {}),
      ...ownerAuthHeaders(method, p, body), // wallet-signed owner auth (required by a multi-tenant CP)
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(`control plane ${r.status}: ${e.error ?? ''}`.trim());
  }
  return r.json();
}

const map = (a) => ({
  state: a.state, node: a.nodeId, health: a.health, id: a.id,
  address: a.address, policy: a.policy, custody: a.custody, paper: a.paper,
  verified: a.verified,
});

export async function create(name, meta) {
  // A bundle agent must have its bytes in the shared store BEFORE it's scheduled, or the node it
  // lands on can't fetch it. Upload, then point the (informational) url at the shared store.
  const b = meta.spec?.bundle;
  if (b?.sha256 && b.url) {
    await putBundle(b.sha256, b.url);
    b.url = `${base()}/v1/bundles/${b.sha256}.tgz`;
  }
  const { agent } = await api('POST', '/v1/agents', {
    name,
    spec: meta.spec,
    policy: meta.spec?.policy,
    ...(meta.spec?.verified ? { verified: meta.spec.verified } : {}),
    ...(meta.owner ? { owner: meta.owner } : {}),
  });
  return { id: agent.id, address: agent.address };
}

// Owner-recovery (off-box custody). The control plane proxies to the signer; the key never
// reaches the CLI for withdraw (only export deliberately returns it).
export async function withdraw(meta, amountSol) {
  return api('POST', `/v1/agents/${meta.id}/withdraw`, amountSol != null ? { amountSol } : {}, 50000);
}
export async function exportKey(meta) {
  return api('POST', `/v1/agents/${meta.id}/export`, {});
}
export async function setOwner(meta, owner) {
  return api('PUT', `/v1/agents/${meta.id}/owner`, { owner });
}

export async function start(_name, meta) {
  const { agent } = await api('POST', `/v1/agents/${meta.id}/start`);
  return map(agent);
}
export async function stop(_name, meta) {
  const { agent } = await api('POST', `/v1/agents/${meta.id}/stop`);
  return map(agent);
}
export async function status(_name, meta) {
  const { agent } = await api('GET', `/v1/agents/${meta.id}`);
  return map(agent);
}
export async function logs(_name, meta, { tail = 20 } = {}) {
  const { lines } = await api('GET', `/v1/agents/${meta.id}/logs`);
  return (lines || []).slice(-tail);
}
export async function destroy(_name, meta, { force = false } = {}) {
  await api('DELETE', `/v1/agents/${meta.id}${force ? '?force=1' : ''}`);
}

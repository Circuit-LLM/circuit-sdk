// Agent facade — manages ~/.circuit/agents/<name>/meta.json, dispatches to a
// driver (local | cloud), and exposes the operator-side host controls.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { config, HOME_DIR } from '../config.js';
import * as local from './drivers/local.js';
import * as cloud from './drivers/cloud.js';
import { sendConfigPatch, commandStatus as cmdStatus } from './agent-commands.js';

const AGENTS_DIR = path.join(HOME_DIR, 'agents');
const HOST_CFG = path.join(HOME_DIR, 'host.json');
const HOST_PID = path.join(HOME_DIR, 'host.pid');

const metaP = (name) => path.join(AGENTS_DIR, name, 'meta.json');
const readMeta = (name) => { try { return JSON.parse(fs.readFileSync(metaP(name), 'utf8')); } catch { return null; } };
const writeMeta = (name, m) => { fs.mkdirSync(path.join(AGENTS_DIR, name), { recursive: true, mode: 0o700 }); fs.writeFileSync(metaP(name), JSON.stringify(m, null, 2)); };
const listNames = () => { try { return fs.readdirSync(AGENTS_DIR).filter((n) => readMeta(n)); } catch { return []; } };
const driverFor = (m) => (m.driver === 'cloud' ? cloud : local);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function withMeta(name, fn) {
  const m = readMeta(name);
  if (!m) throw new Error(`no agent "${name}" — create it first`);
  return fn(m, driverFor(m));
}

// Thin client for a locally-running Circuit node-client. Its cloud-host API is localhost-trusted
// (no token needed from this machine), so the CLI can manage CPU hosting through the node-client —
// the same enable/disable/status the dashboard's Cloud tab uses.
const nodeClient = {
  base: () => config.endpoints.nodeClient.replace(/\/$/, ''),
  async _get(p, timeoutMs = 6000) {
    const r = await fetch(nodeClient.base() + p, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`node-client ${r.status}`);
    return r.json();
  },
  async up() { try { await nodeClient._get('/health', 4000); return true; } catch { return false; } },
  // Combined view: /cloud/status carries the budget + connected flag, /cloud/host/status the live child.
  // Returns null when no node-client is reachable (→ caller falls back to the local path).
  async cloudStatus() {
    if (!(await nodeClient.up())) return null;
    let s = {}; let host = {};
    try { s = await nodeClient._get('/cloud/status'); } catch {}
    try { host = await nodeClient._get('/cloud/host/status'); } catch {}
    return {
      running: !!(host.running ?? s.connected ?? s.enabled ?? false),
      maxAgents: s.maxAgents ?? s.budget?.maxAgents ?? host.maxAgents,
      nodeId: s.nodeId ?? host.nodeId,
    };
  },
  async cloudStart(budget) {
    const r = await fetch(nodeClient.base() + '/cloud/host/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        maxAgents: budget.maxAgents, maxCpu: budget.maxCpu, maxMemoryMb: budget.maxMemoryMb,
        payoutWallet: budget.payoutWallet, controlPlane: config.endpoints.controlPlane,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (j.error === 'node-host-missing') {
        throw new Error('the node-client is running but its agent-host runtime is missing — update the node-client (it bundles the host) and retry.');
      }
      throw new Error(`node-client cloud start ${r.status}: ${j.error ?? ''}`.trim());
    }
    return j;
  },
  async cloudStop() {
    const r = await fetch(nodeClient.base() + '/cloud/host/stop', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(`node-client cloud stop ${r.status}: ${j.error ?? ''}`.trim()); }
    return r.json();
  },
};

export const agents = {
  exists: (name) => !!readMeta(name),
  meta: (name) => readMeta(name),

  async create(name, { driver = 'local', workload = 'agentd', config: cfg = {}, env = {}, policy, verified, owner, bundle } = {}) {
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(name)) throw new Error('name must be 1-32 chars [a-zA-Z0-9_-]');
    if (readMeta(name)) throw new Error(`agent "${name}" already exists`);
    // owner = the wallet funds can be withdrawn back to (the ONLY withdraw destination). For a bundle
    // the owner MUST equal the publisher (the control plane enforces this), so default owner→publisher.
    if (bundle && !owner) owner = bundle.manifest?.publisherPubkey;
    const meta = { name, driver, ...(owner ? { owner } : {}), spec: { workload, config: cfg, env, ...(policy ? { policy } : {}), ...(verified ? { verified } : {}), ...(bundle ? { bundle } : {}) }, createdAt: Date.now() };
    writeMeta(name, meta);
    try {
      const r = await driverFor(meta).create(name, meta);
      if (r?.id) meta.id = r.id;
      if (r?.address) meta.address = r.address;
      if (r?.id || r?.address) writeMeta(name, meta);
    } catch (e) {
      fs.rmSync(path.join(AGENTS_DIR, name), { recursive: true, force: true });
      throw e;
    }
    return meta;
  },

  start: (name) => withMeta(name, (m, d) => d.start(name, m)),
  stop: (name) => withMeta(name, (m, d) => d.stop(name, m)),
  status: (name) => withMeta(name, (m, d) => d.status(name, m)),
  logs: (name, o) => withMeta(name, (m, d) => d.logs(name, m, o)),
  // Owner-recovery: pull funds back to the committed owner / take full custody of the key.
  withdraw: (name, amountSol) => withMeta(name, (m, d) => {
    if (!d.withdraw) throw new Error('withdraw is only for cloud agents (off-box custody)');
    return d.withdraw(m, amountSol);
  }),
  exportKey: (name) => withMeta(name, (m, d) => {
    if (!d.exportKey) throw new Error('export is only for cloud agents (off-box custody)');
    return d.exportKey(m);
  }),
  setOwner: (name, owner) => withMeta(name, (m, d) => {
    if (!d.setOwner) throw new Error('owner is only for cloud agents (off-box custody)');
    return d.setOwner(m, owner);
  }),

  async destroy(name, { force = false } = {}) {
    const m = readMeta(name);
    if (!m) throw new Error(`no agent "${name}"`);
    // Surface a safe-destroy refusal (non-empty wallet) — do NOT delete local state if the
    // off-box wallet still holds funds. Retry with force to abandon them.
    await driverFor(m).destroy(name, m, { force });
    fs.rmSync(path.join(AGENTS_DIR, name), { recursive: true, force: true });
  },

  async list() {
    const out = [];
    for (const n of listNames()) {
      const m = readMeta(n);
      let s = {};
      try { s = await driverFor(m).status(n, m); } catch { s = { state: 'unknown' }; }
      out.push({ name: n, driver: m.driver, workload: m.spec?.workload, ...s });
    }
    return out;
  },

  // ── operator side: contribute CPU capacity to the agent cloud ──
  //
  // The runtime that actually hosts agents is the Circuit node-client (it vendors + supervises the
  // agent-host). So we PREFER to drive a locally-running node-client over its localhost cloud API —
  // the CLI is a thin manager, node-client stays the single runtime. If no node-client is running, we
  // fall back to spawning node-host directly from a circuit-agent-cloud checkout (the operator/dev path).
  host: {
    async status() {
      const nc = await nodeClient.cloudStatus();
      if (nc) return { via: 'node-client', running: !!nc.running, budget: { maxAgents: nc.maxAgents, nodeId: nc.nodeId } };
      // legacy direct-spawn (a local circuit-agent-cloud checkout)
      let pid = null;
      try { pid = Number(fs.readFileSync(HOST_PID, 'utf8')); } catch {}
      const up = pid && alive(pid);
      let budget = {};
      try { budget = JSON.parse(fs.readFileSync(HOST_CFG, 'utf8')); } catch {}
      return { via: 'local', running: !!up, pid: up ? pid : null, budget };
    },
    async start(budget) {
      // 1) Prefer a running node-client — the deployed runtime that bundles the host.
      if (await nodeClient.up()) {
        const r = await nodeClient.cloudStart(budget);
        return { via: 'node-client', running: true, budget: { maxAgents: r.budget?.maxAgents ?? budget.maxAgents, nodeId: budget.nodeId } };
      }
      // 2) Fall back to a local circuit-agent-cloud checkout (operator/dev on a server with the repo).
      const hostScript = path.join(config.agentCloudDir, 'node-host', 'host.js');
      if (!fs.existsSync(hostScript)) {
        throw new Error(
          'No Circuit node-client is running, and no agent-host runtime was found locally. The simplest '
          + 'way to contribute CPU is to run a node-client (it bundles the host) and retry — install it with:  '
          + `curl -fsSL ${config.endpoints.join} | bash   `
          + '(or enable the Cloud tab in its dashboard). Operators with a circuit-agent-cloud checkout can '
          + 'instead set CIRCUIT_AGENT_CLOUD_DIR=<path>.',
        );
      }
      fs.mkdirSync(HOME_DIR, { recursive: true });
      fs.writeFileSync(HOST_CFG, JSON.stringify(budget, null, 2));
      const out = fs.openSync(path.join(HOME_DIR, 'host.log'), 'a');
      const env = {
        ...process.env,
        CONTROL_PLANE: config.endpoints.controlPlane,
        NODE_ID: budget.nodeId || `node-${os.hostname()}`,
        MAX_AGENTS: String(budget.maxAgents ?? 5),
        MAX_MEMORY_MB: String(budget.maxMemoryMb ?? 512),
        CIRCUIT_AGENT_DIR: config.circuitAgentDir,
        // Pull bundle bytes from the control plane's shared store (so a bundle published on ANY machine
        // runs here). Don't override an explicit operator setting.
        CIRCUIT_BUNDLE_STORE_URL: process.env.CIRCUIT_BUNDLE_STORE_URL || `${config.endpoints.controlPlane.replace(/\/$/, '')}/v1/bundles`,
      };
      const child = spawn(process.execPath, [hostScript], { detached: true, stdio: ['ignore', out, out], env });
      fs.writeFileSync(HOST_PID, String(child.pid));
      child.unref();
      return { via: 'local', running: true, pid: child.pid, budget };
    },
    async stop() {
      if (await nodeClient.up()) { await nodeClient.cloudStop(); return { via: 'node-client', running: false }; }
      let pid = null;
      try { pid = Number(fs.readFileSync(HOST_PID, 'utf8')); } catch {}
      if (pid) { try { process.kill(pid, 'SIGTERM'); } catch {} }
      try { fs.unlinkSync(HOST_PID); } catch {}
      return { via: 'local', running: false };
    },
  },

  // ── Command Inbox (docs/COMMAND_INBOX.md) — owner→agent control (cloud agents only) ──
  command: (name, patch, opts) =>
    withMeta(name, (m) => {
      if (m.driver !== 'cloud') throw new Error('commands target cloud (mesh) agents — a local agent is controlled directly');
      return sendConfigPatch(name, m, patch, opts);
    }),
  commandStatus: (name) =>
    withMeta(name, (m) => {
      if (m.driver !== 'cloud') throw new Error('commands target cloud (mesh) agents');
      return cmdStatus(name, m);
    }),
};

// Local driver — runs an agent as a detached process on this machine.
// Mirrors the cloud driver's interface so the module is driver-agnostic.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, HOME_DIR } from '../../config.js';

const dirOf = (name) => path.join(HOME_DIR, 'agents', name);
const agentdPath = () => path.join(config.agentCloudDir, 'agentd', 'agentd.js');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = (dir) => { try { return Number(fs.readFileSync(path.join(dir, 'agent.pid'), 'utf8')); } catch { return null; } };
const readHb = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'heartbeat.json'), 'utf8')); } catch { return null; } };

export async function create() { return {}; } // nothing extra to register locally

export async function start(name, meta) {
  const dir = dirOf(name);
  fs.mkdirSync(dir, { recursive: true });
  const existing = readPid(dir);
  if (existing && alive(existing)) return { state: 'running', pid: existing };

  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(meta.spec?.config || {}));
  const args =
    meta.spec?.workload === 'circuit-agent'
      ? [path.join(config.circuitAgentDir, 'agent.js'), 'start']
      : [agentdPath()];
  const out = fs.openSync(path.join(dir, 'agent.log'), 'a');
  const child = spawn(process.execPath, args, {
    cwd: dir,
    env: { ...process.env, CIRCUIT_AGENT_DATA_DIR: dir, AGENT_NAME: name, ...(meta.spec?.env || {}) },
    detached: true,
    stdio: ['ignore', out, out],
  });
  fs.writeFileSync(path.join(dir, 'agent.pid'), String(child.pid));
  child.unref();
  return { state: 'running', pid: child.pid };
}

export async function stop(name) {
  const dir = dirOf(name);
  const pid = readPid(dir);
  if (pid && alive(pid)) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  return { state: 'stopped' };
}

export async function status(name) {
  const dir = dirOf(name);
  const pid = readPid(dir);
  const up = pid && alive(pid);
  return { state: up ? 'running' : 'stopped', pid: up ? pid : null, node: 'local', health: readHb(dir) };
}

export async function logs(name, _meta, { tail = 20 } = {}) {
  try {
    const lines = fs.readFileSync(path.join(dirOf(name), 'agent.log'), 'utf8').trim().split('\n');
    return lines.slice(-tail).filter(Boolean).map((line) => ({ line }));
  } catch {
    return [];
  }
}

export async function destroy(name) {
  await stop(name);
}

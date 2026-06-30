// Static configuration + a small user-config layer (~/.circuit/config.json).
// Nothing secret lives here. The wallet keypair is loaded separately by the
// solana service from ~/.circuit/id.json or the CIRCUIT_WALLET env var.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME_DIR = path.join(os.homedir(), '.circuit');
export const CONFIG_FILE = path.join(HOME_DIR, 'config.json');
export const WALLET_FILE = path.join(HOME_DIR, 'id.json');

// Circuit ecosystem constants.
export const CIRC = {
  mint: '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump',
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  decimals: 6,
  symbol: 'CIRC',
};
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Agent Vault — non-custodial on-chain custody (circuit-agent-vault). The program id is fixed (the
// deployed program); point at the cluster it's deployed to via CIRCUIT_RPC_URL or `--rpc`.
export const VAULT = {
  programId: process.env.CIRCUIT_VAULT_PROGRAM || '9AmhsDD9AwUM57pLwYsmNWhjdAP5vTy2HXxqbdKRaxXA',
};

const DEFAULTS = {
  version: '0.2.1',
  web: 'circuitllm.xyz',
  model: 'Qwen2.5-72B · decentralized',
  // The model id the inference gateway accepts. 'circuit' is the alias the
  // gateway maps to the live model; the explicit id also works.
  inferenceModel: 'circuit',
  // Default system prompt — grounds the model in what Circuit actually is.
  // Override per call with `circuit chat --system "..."` or in user config.
  systemPrompt:
    'You are Circuit, the assistant for Circuit LLM — a decentralized intelligence network. ' +
    'Always respond in English unless the user explicitly writes to you in another language. ' +
    'The model is served across a mesh of independent commodity GPUs and paid per request in CIRC ' +
    '(a Solana token) via x402 micropayments. The ecosystem also includes an autonomous trading-agent ' +
    'swarm, and anyone can contribute a GPU to the mesh to earn from the inference they serve. ' +
    'Be concise, accurate, and genuinely helpful, and reply in English.',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  output: 'pretty', // 'pretty' | 'json'
  // Agent cloud: where the control plane lives, and where the cloud service +
  // reference workload are installed (for the local driver and `agent host`).
  agentCloudDir: process.env.CIRCUIT_AGENT_CLOUD_DIR || path.join(os.homedir(), 'circuit-agent-cloud'),
  circuitAgentDir: process.env.CIRCUIT_AGENT_DIR || path.join(os.homedir(), 'circuit-agent'),
  endpoints: {
    inference: 'https://inference.circuitllm.xyz/v1',
    data: 'https://api.circuitllm.xyz',
    join: 'https://circuitllm.xyz/join',
    health: 'https://circuitllm.xyz',
    // circuit-node: the public swarm registry is served at api.circuitllm.xyz
    // (free, read-only). Market/network data is x402-gated for non-localhost, so
    // it is only free on the coordinator host via the local port.
    nodePublic: 'https://api.circuitllm.xyz',
    node: 'http://localhost:18940',
    priceFeed: 'http://localhost:18941',
    // Agent cloud control plane. Defaults to the public mesh; override with CIRCUIT_CONTROL_PLANE
    // (e.g. http://127.0.0.1:18980 when running a control plane locally).
    controlPlane: process.env.CIRCUIT_CONTROL_PLANE || 'https://agents.circuitllm.xyz',
    // Off-box signer (custody). The control plane talks to it; the CLI uses this
    // only to read an agent's wallet/policy directly when asked.
    signer: process.env.CIRCUIT_SIGNER || 'http://127.0.0.1:18981',
    // Local Circuit node-client API. node-client is the runtime that actually contributes CPU to the
    // agent cloud (it vendors + supervises the agent-host); `circuit agent host` drives it over this
    // localhost API. Default apiPort 19000; override with CIRCUIT_NODE_API.
    nodeClient: process.env.CIRCUIT_NODE_API || 'http://127.0.0.1:19000',
  },
  links: {
    web: 'https://circuitllm.xyz',
    docs: 'https://circuitllm.xyz/docs',
  },
};

let _user = null;
function loadUser() {
  if (_user) return _user;
  try {
    _user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    _user = {};
  }
  return _user;
}

// Deep-ish merge: user config overrides defaults (endpoints merged shallowly).
function build() {
  const u = loadUser();
  return {
    ...DEFAULTS,
    ...u,
    endpoints: { ...DEFAULTS.endpoints, ...(u.endpoints || {}) },
    links: { ...DEFAULTS.links, ...(u.links || {}) },
    // env overrides for convenience
    rpcUrl: process.env.CIRCUIT_RPC_URL || u.rpcUrl || DEFAULTS.rpcUrl,
  };
}

export const config = build();

export function saveUserConfig(patch) {
  const next = { ...loadUser(), ...patch };
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  _user = next;
  Object.assign(config, build());
  return config;
}

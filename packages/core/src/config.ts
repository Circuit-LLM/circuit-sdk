// Injectable Circuit configuration. The #1 change from circuit-cli's services:
// NO global singleton and NO hardcoded ~/.circuit paths — everything is passed in.
// Defaults mirror circuit-cli/src/config.js so the SDK talks to the live ecosystem.

export interface CircuitEndpoints {
  /** Inference gateway base (OpenAI-compatible), e.g. https://inference.circuitllm.xyz/v1 */
  inference: string;
  /** Data API base (x402-paid market/on-chain data) */
  data: string;
  /** Public swarm/network registry (free read-only) */
  nodePublic: string;
  /** Agent-cloud control plane */
  controlPlane: string;
  /** Off-box custody signer */
  signer: string;
}

export interface CircuitConfig {
  endpoints: CircuitEndpoints;
  /** Solana RPC used for payment verification + on-chain reads */
  rpcUrl: string;
  /** CIRC SPL mint (Token-2022) */
  circMint: string;
  /** CIRC token program */
  circTokenProgram: string;
  circDecimals: number;
  /** Model id the inference gateway accepts ('circuit' is the live alias) */
  model: string;
}

export const CIRC_MINT = '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump';
export const CIRC_TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const CIRC_DECIMALS = 6;
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

export const DEFAULT_CONFIG: CircuitConfig = {
  endpoints: {
    inference: 'https://inference.circuitllm.xyz/v1',
    data: 'https://api.circuitllm.xyz',
    nodePublic: 'https://api.circuitllm.xyz',
    controlPlane: 'http://127.0.0.1:18980',
    signer: 'http://127.0.0.1:18981',
  },
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  circMint: CIRC_MINT,
  circTokenProgram: CIRC_TOKEN_PROGRAM,
  circDecimals: CIRC_DECIMALS,
  model: 'circuit',
};

export interface CircuitConfigOverrides {
  endpoints?: Partial<CircuitEndpoints>;
  rpcUrl?: string;
  circMint?: string;
  circTokenProgram?: string;
  circDecimals?: number;
  model?: string;
}

/** Merge overrides onto the defaults (endpoints merged shallowly). */
export function defineConfig(overrides: CircuitConfigOverrides = {}): CircuitConfig {
  const { endpoints, ...rest } = overrides;
  return {
    ...DEFAULT_CONFIG,
    ...rest,
    endpoints: { ...DEFAULT_CONFIG.endpoints, ...(endpoints ?? {}) },
  };
}

/** Optional convenience: pull overrides from environment variables. */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): CircuitConfigOverrides {
  const endpoints: Partial<CircuitEndpoints> = {};
  if (env.CIRCUIT_INFERENCE_URL) endpoints.inference = env.CIRCUIT_INFERENCE_URL;
  if (env.CIRCUIT_DATA_URL) endpoints.data = env.CIRCUIT_DATA_URL;
  if (env.CIRCUIT_CONTROL_PLANE) endpoints.controlPlane = env.CIRCUIT_CONTROL_PLANE;
  if (env.CIRCUIT_SIGNER) endpoints.signer = env.CIRCUIT_SIGNER;
  const overrides: CircuitConfigOverrides = {};
  if (Object.keys(endpoints).length) overrides.endpoints = endpoints;
  if (env.CIRCUIT_RPC_URL) overrides.rpcUrl = env.CIRCUIT_RPC_URL;
  return overrides;
}

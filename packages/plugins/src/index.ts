// @circuit-llm/plugins — framework adapters that expose the Circuit Data API to
// agent frameworks. Each endpoint is paid per call in CIRC via x402; free-tier
// endpoints work with no wallet.
//
//   ElizaOS:          import { circuitPlugin } from '@circuit-llm/plugins/eliza';
//   Solana Agent Kit: import { circuitAgentKitActions } from '@circuit-llm/plugins/agent-kit';
//   Any framework:    import { circuitActions } from '@circuit-llm/plugins';  // neutral catalog

export { CIRCUIT_ACTIONS, circuitActions } from './actions.ts';
export type { CircuitAction, CircuitActionsOptions } from './actions.ts';

export { circuitPlugin } from './eliza.ts';
export type { ElizaPlugin } from './eliza.ts';

export { circuitAgentKitActions } from './agent-kit.ts';
export type { AgentKitAction } from './agent-kit.ts';

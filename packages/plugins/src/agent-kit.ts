// Solana Agent Kit adapter for Circuit data.
//
//   import { circuitAgentKitActions } from '@circuit-llm/plugins/agent-kit';
//   const actions = circuitAgentKitActions({ tier: 'free' });
//   // register each with your SolanaAgentKit instance / LangChain tool list
//
// Solana Agent Kit actions are plain objects with a name, description, a zod-like
// schema, and a handler(agent, input). We emit that shape structurally so this works
// whether the host uses the classic action registry or the LangChain tool bridge —
// no hard dependency on solana-agent-kit's evolving types.

import { circuitActions, type CircuitActionsOptions, type CircuitAction } from './actions.ts';

export interface AgentKitAction {
  name: string;
  description: string;
  /** JSON-schema description of the input (Agent Kit / LangChain both accept this). */
  schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<{ status: 'success' | 'error'; result?: unknown; message?: string }>;
}

function toAgentKitAction(action: CircuitAction, data: ReturnType<typeof circuitActions>['data']): AgentKitAction {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(action.params)) {
    properties[key] = { type: spec.type, description: spec.description };
    if (spec.required) required.push(key);
  }
  return {
    name: action.name.toUpperCase(),
    description: action.description,
    schema: { type: 'object', properties, required },
    handler: async (input) => {
      try {
        const result = await action.run(data, input ?? {});
        return { status: 'success', result };
      } catch (err) {
        return { status: 'error', message: (err as Error).message };
      }
    },
  };
}

/** Build Solana Agent Kit actions. `tier: 'all'` enables paid endpoints (needs a funded wallet). */
export function circuitAgentKitActions(opts: CircuitActionsOptions = {}): AgentKitAction[] {
  const { data, actions } = circuitActions(opts);
  return actions.map((a) => toAgentKitAction(a, data));
}

export default circuitAgentKitActions;

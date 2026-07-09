// ElizaOS plugin adapter for Circuit data.
//
//   import { circuitPlugin } from '@circuit-llm/plugins/eliza';
//   const runtime = new AgentRuntime({ plugins: [circuitPlugin({ tier: 'free' })] });
//
// Structurally typed against the ElizaOS Plugin/Action shape (name, actions[]) so it
// works without a hard dependency on @elizaos/core — the host runtime supplies the
// concrete types at load time. Each Circuit action becomes an Eliza Action whose
// handler pays x402 (when the endpoint is paid) and returns the JSON result.

import { circuitActions, type CircuitActionsOptions, type CircuitAction } from './actions.ts';

// Minimal shapes mirroring @elizaos/core (avoids a version-pinned peer dep).
interface ElizaActionExample { user: string; content: { text: string } }
interface ElizaAction {
  name: string;
  similes: string[];
  description: string;
  validate: (...args: unknown[]) => Promise<boolean>;
  handler: (runtime: unknown, message: unknown, state: unknown, options: Record<string, unknown>, callback?: (r: { text: string }) => void) => Promise<unknown>;
  examples: ElizaActionExample[][];
}
export interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
}

function toElizaAction(action: CircuitAction, data: ReturnType<typeof circuitActions>['data']): ElizaAction {
  const simile = action.name.replace(/^circuit_/, '').toUpperCase();
  return {
    name: action.name.toUpperCase(),
    similes: [simile, `CIRCUIT_${simile}`],
    description: action.description,
    validate: async () => true,
    handler: async (_runtime, message, _state, options, callback) => {
      // Args come from the caller's options, falling back to the message's structured content.
      const msgContent = (message as { content?: Record<string, unknown> } | undefined)?.content ?? {};
      const args = { ...msgContent, ...(options ?? {}) };
      let result: unknown, text: string;
      try {
        result = await action.run(data, args);
        text = JSON.stringify(result);
      } catch (err) {
        result = { error: (err as Error).message };
        text = `Circuit ${action.name} failed: ${(err as Error).message}`;
      }
      callback?.({ text });
      return result;
    },
    examples: [[
      { user: '{{user1}}', content: { text: `Use ${action.name}` } },
    ]],
  };
}

/** Build the ElizaOS plugin. `tier: 'all'` enables paid endpoints (needs a funded wallet). */
export function circuitPlugin(opts: CircuitActionsOptions = {}): ElizaPlugin {
  const { data, actions } = circuitActions(opts);
  return {
    name: 'circuit',
    description: 'Circuit Data — live Solana market & on-chain data (prices, security, holders, market regime), paid per call in CIRC via x402.',
    actions: actions.map((a) => toElizaAction(a, data)),
  };
}

export default circuitPlugin;

// The module registry — the single source of truth. Both the interactive menu
// and the commander verbs are generated from this list, so they never drift.
import chat from '../modules/chat.js';
import wallet from '../modules/wallet.js';
import data from '../modules/data.js';
import swarm from '../modules/swarm.js';
import agent from '../modules/agent.js';
import network from '../modules/network.js';
import node from '../modules/node.js';
import status from '../modules/status.js';
import about from '../modules/about.js';

export const modules = [chat, wallet, data, swarm, agent, network, node, status, about];

// Build `circuit <id>` for each module (default action = its screen), then let
// the module attach any sub-verbs / options.
export function registerCommands(program, ctx) {
  for (const m of modules) {
    const cmd = program
      .command(m.id)
      .description(m.desc)
      .action(() => m.screen(ctx, { standalone: true }));
    m.register?.(cmd, ctx);
  }
}

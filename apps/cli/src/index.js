// Top-level dispatch. No args → the interactive console. A verb → run it
// directly. Help / version handled by commander without any network calls.
import { Command } from 'commander';
import { config } from './config.js';
import { registerCommands } from './core/registry.js';
import { splash } from './core/splash.js';
import { mainMenu } from './core/menu.js';
import { pressKey } from './ui/index.js';

async function runInteractive() {
  const status = await splash();
  await pressKey('', { silent: true });
  await mainMenu({ config, status });
}

export async function run() {
  if (process.argv.length <= 2) {
    await runInteractive();
    return;
  }

  const program = new Command();
  program
    .name('circuit')
    .description('Circuit LLM — the command line for the decentralized intelligence network')
    .version(config.version, '-v, --version', 'output the version');

  // Verbs don't need a network probe; standalone screens show their own header.
  const ctx = { config, status: {} };
  program.command('menu').description('open the interactive console').action(runInteractive);
  registerCommands(program, ctx);

  await program.parseAsync(process.argv);
}

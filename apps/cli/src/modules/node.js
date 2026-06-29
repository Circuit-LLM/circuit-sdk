import { c, sym, panel, heading } from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { node } from '../services/node.js';

async function joinScreen(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone, footer: 'press any key to go back' }, async () => {
    console.log(heading('Contribute a GPU', sym.node));
    console.log('');
    console.log(
      panel(
        [
          c.muted('Attach a GPU (or CPU) to the Circuit mesh and earn CIRC from'),
          c.muted('every inference your node helps serve. One command:'),
          '',
          '  ' + c.accent(node.joinCommand()),
          '',
          c.dim('It installs a small Docker node and registers with the'),
          c.dim('coordinator. Nodes start on probation and graduate to trusted'),
          c.dim('as they pass verification challenges.'),
        ].join('\n'),
        { title: 'JOIN THE MESH' },
      ),
    );
    console.log('');
    console.log(c.dim(`  ${sym.chevron} copy the command above to onboard a machine.`));
  });
}

export default {
  id: 'node',
  icon: sym.node,
  name: 'Node',
  desc: 'Contribute a GPU to the mesh',
  screen(ctx, opts = {}) {
    return joinScreen(ctx, opts.standalone);
  },
  register(cmd, ctx) {
    cmd.command('join').description('show the one-line GPU join command').action(() => joinScreen(ctx, true));
  },
};

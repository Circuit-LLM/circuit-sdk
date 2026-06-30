// The interactive main-menu loop.
import { menuSelect, clearScreen, slimHeader, c, sym, brand } from '../ui/index.js';
import { modules } from './registry.js';

export async function mainMenu(ctx) {
  for (;;) {
    clearScreen();
    slimHeader(ctx.status);

    const choice = await menuSelect(c.text('Where would you like to go?'), [
      ...modules.map((m) => ({ value: m.id, label: `${m.icon}  ${m.name}`, hint: m.desc })),
      { value: '__exit', label: `${sym.cross}  Exit`, hint: 'leave the Circuit console' },
    ]);

    if (choice === '__exit') {
      console.log('\n  ' + brand(`${sym.circuit} Disconnected from the Circuit mesh.`) + '\n');
      process.exit(0);
    }

    const m = modules.find((x) => x.id === choice);
    if (m) await m.screen(ctx, { standalone: false });
  }
}

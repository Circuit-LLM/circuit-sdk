// Standard frame for static module screens: clear, header, draw, wait.
// Interactive screens (chat REPL, live watch) manage their own loop.
import { clearScreen, slimHeader, compactBrand, pressKey } from '../ui/index.js';

export async function screenFrame({ status, standalone = false, footer = 'press any key to return' }, draw) {
  clearScreen();
  if (standalone) compactBrand();
  else {
    slimHeader(status);
    console.log('');
  }
  await draw();
  await pressKey(standalone ? 'press any key to exit' : footer);
}

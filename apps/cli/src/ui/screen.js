// Screen chrome — headers, footers, keypress. Imports config lazily so the
// version/status reads stay current.
import { config } from '../config.js';
import { c, sym, brand } from '../theme.js';
import { cols, splitLine, divider, clearScreen, center } from './layout.js';
import { statusDot } from './components.js';

// Slim brand bar used above module screens and the menu.
export function slimHeader(status = {}) {
  const left = brand(`${sym.circuit} CIRCUIT`) + ' ' + c.muted('LLM');
  const net = status.online
    ? `${c.ok(sym.dot)} ${c.text('mesh online')}`
    : `${c.dim(sym.ring)} ${c.muted('offline')}`;
  const right = `${net}  ${c.dim('·')}  ${c.muted('v' + config.version)}`;
  console.log('');
  console.log(' ' + splitLine(left, right, cols() - 2));
  console.log(divider());
}

// Big centred wordmark for standalone command screens.
export function compactBrand() {
  console.log('');
  console.log(center(brand(`${sym.circuit} CIRCUIT LLM`)));
  console.log('');
}

export function footerHint(text) {
  console.log('');
  console.log(c.dim(`  ${sym.chevron} ${text}`));
}

// Block for a single keypress. Resolves immediately when not a TTY so piped /
// scripted runs never hang. Ctrl-C exits cleanly.
export function pressKey(label = 'press any key to continue', { silent = false } = {}) {
  return new Promise((resolve) => {
    if (!silent) process.stdout.write('\n' + c.dim(`  ${sym.chevron} ${label}\n`));
    const stdin = process.stdin;
    if (!stdin.isTTY) return resolve();
    const prev = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (d) => {
      stdin.removeListener('data', onData);
      stdin.pause(); // pause first → any trailing bytes of a multi-byte key buffer instead of leaking
      if (d && d[0] === 3) {
        try { stdin.setRawMode(prev || false); } catch {}
        process.stdout.write('\n');
        process.exit(0);
      }
      // Drain the rest of a multi-byte keypress (an arrow is ESC [ A) so the next consumer — the
      // clack menu — doesn't inherit a dangling ESC and stall on its escape-sequence timeout.
      setImmediate(() => {
        drainStdin();
        try { stdin.setRawMode(prev || false); } catch {}
        resolve();
      });
    };
    stdin.on('data', onData);
  });
}

// Discard any buffered bytes sitting in stdin (typically the tail of a multi-byte key). Call with
// stdin paused — in paused mode read() returns buffered chunks until empty. This is what prevents a
// stale/partial ESC from making the next raw-mode reader (the menu) wait out an escape-sequence
// timeout, which is the "the main menu freezes for a moment before arrows work" bug.
export function drainStdin() {
  const stdin = process.stdin;
  if (!stdin.isTTY) return;
  try { while (stdin.read() !== null) { /* discard */ } } catch { /* noop */ }
}

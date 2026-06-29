# Contributing

circuit-cli is open source under the MIT license. Contributions are welcome — new modules, new services, design polish, bug fixes, and documentation.

---

## Development Setup

```bash
git clone https://github.com/Circuit-LLM/circuit-cli
cd circuit-cli
npm install

node bin/circuit.js            # run the console
node bin/circuit.js --help     # see every command
```

Requires Node.js ≥ 18 (native `fetch`). No build step — it runs from source.

---

## The three layers

The whole codebase follows one rule: **`services` talk, `ui` draws, `modules` glue.** Keep that separation and most things stay simple.

- **`src/services/`** — clients for the ecosystem (HTTP / Solana). They return data and **never print to the console**.
- **`src/ui/`** — pure rendering (layout, components, charts, prompts). No domain logic, no network.
- **`src/modules/`** — features. Each one wires a service to the UI, owns its screen, and registers its command verbs.
- **`src/core/`** — `registry` (the single source of truth), `menu`, `splash`, `context`, `render`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full map.

---

## Add a module

A module is one file in `src/modules/` exporting `{ id, icon, name, desc, screen, register? }`:

```js
import { c, sym, panel, kv, spinner } from '../ui/index.js';
import { screenFrame } from '../core/render.js';
import { circuitNode } from '../services/circuitNode.js';

async function view(ctx, standalone) {
  await screenFrame({ status: ctx.status, standalone }, async () => {
    const sp = spinner('Loading…');
    const data = await circuitNode.swarmStats();   // services do the talking
    sp.success('Loaded');
    console.log(panel(kv('Agents', c.text(data.agents.total)), { title: 'EXAMPLE' }));
  });
}

export default {
  id: 'example',
  icon: sym.diamond,
  name: 'Example',
  desc: 'a one-line description',
  screen: (ctx, opts = {}) => view(ctx, opts.standalone),
  register(cmd, ctx) {
    cmd.command('thing').description('do a thing').action(() => view(ctx, true));
  },
};
```

Then add it to `src/core/registry.js`. That single line wires it into **both** the interactive menu and the `circuit example` command — they can't drift.

---

## Design conventions

- Compose screens from `src/ui/` — don't hand-roll boxes or colours. The palette and glyphs live in `src/theme.js`.
- **Glyphs must be width-1.** A width-2 glyph (e.g. `⚡`) breaks box alignment in `boxen`. Check new glyphs with `string-width` before using them.
- Reads should work without a wallet; **writes** (`send`, `swap`, paid `chat`) must confirm before acting.
- Keep commands pipe-friendly: `--json` for machine output, raw text to stdout, status/notes to stderr.

---

## Commit & PR

- Keep changes focused; match the surrounding style (ESM, no build step).
- Test the paths you touched — `circuit status doctor` is a quick smoke test for connectivity.
- Open a PR against `main` with a short description of the change and why.

---

## Reporting issues

Bugs and feature requests: open a GitHub issue. **Security issues:** see [SECURITY.md](SECURITY.md) — report privately, not in a public issue.

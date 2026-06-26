// Scaffold a starter agent project. `scaffold(name)` returns a path→content map;
// `writeScaffold(name, dir)` writes it. (The `circuit-agent new` bin wraps this at
// publish time, once packages emit dist/.)

function pascal(name: string): string {
  return name
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('') || 'Agent';
}

function slug(name: string): string {
  return (name.replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agent');
}

export function scaffold(name: string): Record<string, string> {
  const id = slug(name);
  const Cls = pascal(name);

  const pkg = {
    name: id,
    version: '0.0.0',
    private: true,
    type: 'module',
    description: `A Circuit agent (${id})`,
    scripts: {
      // run locally in paper mode (no signer) — the same code the cloud hosts
      start: 'node --experimental-strip-types agent.ts',
    },
    dependencies: {
      '@circuit/agent': '^0.0.0',
    },
  };

  const agent = `import { CircuitAgent } from '@circuit/agent';

// ${Cls} runs on Circuit's CPU mesh. Custody is off-box: this.buy/this.sell go to
// the signer (which holds the key + enforces buy/sell-only policy). Locally, with no
// signer wired, it paper-trades with identical semantics — so this same file runs in
// dev and in the cloud.
class ${Cls} extends CircuitAgent {
  async setup() {
    this.readConfig();
    this.log('${id} ready');
  }

  async tick() {
    // 1) sense — e.g. const trending = await this.data().tokenTrending();
    // 2) think — e.g. const out = await this.inference({ wallet }).chat({ messages });
    // 3) act   — e.g. if (signal) await this.buy(mint, sizeSol);
    this.log('tick (no strategy yet)');
  }

  async onDrain() {
    // node budget cut / reschedule — checkpoint here
  }
}

new ${Cls}().run();
`;

  const config = {
    scanIntervalMs: 5000,
    strategy: 'dip-reversal',
    tradeSizeSol: 0.01,
    paperTrading: true,
  };

  const readme = `# ${id}

A [Circuit](https://circuitllm.xyz) agent built with \`@circuit/agent\`.

\`\`\`bash
npm install
npm start          # paper mode (no signer) — identical semantics to the cloud
\`\`\`

Deploy it to Circuit's CPU mesh with the \`circuit agent\` CLI. Custody is off-box:
your strategy never holds the key, and it can only \`buy\`/\`sell\` within policy.
`;

  return {
    'package.json': JSON.stringify(pkg, null, 2) + '\n',
    'agent.ts': agent,
    'config.json': JSON.stringify(config, null, 2) + '\n',
    'README.md': readme,
  };
}

/** Write a scaffolded project into `dir`. Returns the relative paths written. */
export async function writeScaffold(name: string, dir: string): Promise<string[]> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const files = scaffold(name);
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    await writeFile(join(dir, rel), content);
    written.push(rel);
  }
  return written;
}

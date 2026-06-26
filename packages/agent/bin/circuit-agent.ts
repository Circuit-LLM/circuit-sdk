#!/usr/bin/env node
// circuit-agent — scaffold a starter agent project.
//   circuit-agent new <name> [dir]
import { writeScaffold } from '../src/scaffold.ts';

async function main(): Promise<void> {
  const [cmd, name, dir] = process.argv.slice(2);
  if (cmd !== 'new' || !name) {
    console.error('usage: circuit-agent new <name> [dir]');
    process.exit(1);
  }
  const target = dir ?? name;
  const written = await writeScaffold(name, target);
  console.log(`created ${target}/`);
  for (const f of written) console.log(`  ${f}`);
  console.log(`\nnext:\n  cd ${target} && npm install && npm start   # paper mode`);
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});

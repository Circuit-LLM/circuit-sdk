import { test } from 'node:test';
import assert from 'node:assert';
import { scaffold } from '../src/scaffold.ts';

test('scaffold generates a runnable starter project', () => {
  const files = scaffold('My Cool Bot');
  assert.ok(files['package.json']);
  assert.ok(files['agent.ts']);
  assert.ok(files['config.json']);
  const pkg = JSON.parse(files['package.json']!);
  assert.equal(pkg.name, 'my-cool-bot');
  assert.ok(pkg.dependencies['@circuit/agent']);
  assert.match(files['agent.ts']!, /class MyCoolBot extends CircuitAgent/);
  assert.match(files['agent.ts']!, /new MyCoolBot\(\)\.run\(\)/);
  const cfg = JSON.parse(files['config.json']!);
  assert.equal(cfg.paperTrading, true);
});

test('scaffold slugifies + PascalCases odd names', () => {
  const files = scaffold('  weird__Name!!  ');
  assert.equal(JSON.parse(files['package.json']!).name, 'weird-name');
  assert.match(files['agent.ts']!, /class WeirdName extends CircuitAgent/);
});

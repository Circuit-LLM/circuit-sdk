import { test } from 'node:test';
import assert from 'node:assert';
import { defineConfig, configFromEnv, DEFAULT_CONFIG, CIRC_MINT } from '../src/config.ts';

test('defineConfig merges endpoints shallowly, keeps untouched defaults', () => {
  const c = defineConfig({ endpoints: { inference: 'http://local/v1' }, rpcUrl: 'http://rpc' });
  assert.equal(c.endpoints.inference, 'http://local/v1');
  assert.equal(c.endpoints.data, DEFAULT_CONFIG.endpoints.data);
  assert.equal(c.rpcUrl, 'http://rpc');
  assert.equal(c.circMint, CIRC_MINT);
});

test('defineConfig with no args returns the defaults (new object)', () => {
  const c = defineConfig();
  assert.deepEqual(c, DEFAULT_CONFIG);
  assert.notEqual(c, DEFAULT_CONFIG);
  assert.notEqual(c.endpoints, DEFAULT_CONFIG.endpoints);
});

test('configFromEnv reads recognized env overrides', () => {
  const o = configFromEnv({ CIRCUIT_RPC_URL: 'http://r', CIRCUIT_SIGNER: 'http://s' } as NodeJS.ProcessEnv);
  assert.equal(o.rpcUrl, 'http://r');
  assert.equal(o.endpoints?.signer, 'http://s');
});

test('configFromEnv returns empty overrides when nothing is set', () => {
  assert.deepEqual(configFromEnv({} as NodeJS.ProcessEnv), {});
});

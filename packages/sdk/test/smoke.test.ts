import { test } from 'node:test';
import assert from 'node:assert';
import {
  Inference,
  Data,
  Wallet,
  makeWallet,
  X402Client,
  defineConfig,
  CIRC_MINT,
  circRawFromUsd,
} from '@circuit/sdk';

test('the meta-package re-exports the whole surface', () => {
  assert.equal(typeof Inference, 'function');
  assert.equal(typeof Data, 'function');
  assert.equal(typeof Wallet, 'function');
  assert.equal(typeof makeWallet, 'function');
  assert.equal(typeof X402Client, 'function');
  assert.equal(typeof defineConfig, 'function');
  assert.equal(CIRC_MINT, '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');
  assert.equal(circRawFromUsd(0.001, 0.0001), 10_000_000n);
});

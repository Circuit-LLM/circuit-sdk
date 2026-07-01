import { test } from 'node:test';
import assert from 'node:assert';
import { Connection } from '@solana/web3.js';
import { defineConfig } from '@circuit-llm/core';
import { Wallet } from '../src/wallet.ts';
import { usesDefaultPublicRpc, _resetRpcWarning } from '../src/rpc-warning.ts';
import { generateKeypair } from '../src/keypair.ts';

const anyConn = {} as unknown as Connection;

// Capture console.warn for the duration of `fn`, returning everything it emitted.
function captureWarn(fn: () => void): string[] {
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return calls;
}

test('usesDefaultPublicRpc: true only when nothing overrides the RPC', () => {
  assert.equal(usesDefaultPublicRpc({}), true);
  assert.equal(usesDefaultPublicRpc({ config: defineConfig() }), true); // config, but rpcUrl is the default
  assert.equal(usesDefaultPublicRpc({ rpcUrl: 'https://my-rpc' }), false);
  assert.equal(usesDefaultPublicRpc({ connection: anyConn }), false);
  assert.equal(usesDefaultPublicRpc({ connections: [anyConn] }), false);
  assert.equal(usesDefaultPublicRpc({ config: defineConfig({ rpcUrl: 'https://my-rpc' }) }), false);
});

test('warns exactly once on the default public RPC, and never when overridden', () => {
  _resetRpcWarning();
  delete process.env.CIRCUIT_SUPPRESS_RPC_WARNING;

  const calls = captureWarn(() => {
    new Wallet({ keypair: generateKeypair() }); //                              default → warns
    new Wallet({ keypair: generateKeypair() }); //                              default again → deduped
    new Wallet({ keypair: generateKeypair(), rpcUrl: 'https://my-rpc' }); //    override → silent
    new Wallet({ keypair: generateKeypair(), connection: anyConn }); //         override → silent
  });

  assert.equal(calls.length, 1, 'exactly one warning across all constructions');
  assert.match(calls[0]!, /public Solana RPC|rate-limit/i);
  assert.match(calls[0]!, /CIRCUIT_RPC_URL|rpcUrl/, 'points at the fix');
});

test('the warning is silenced by CIRCUIT_SUPPRESS_RPC_WARNING=1', () => {
  _resetRpcWarning();
  process.env.CIRCUIT_SUPPRESS_RPC_WARNING = '1';
  try {
    const calls = captureWarn(() => {
      new Wallet({ keypair: generateKeypair() }); // default RPC, but suppressed
    });
    assert.equal(calls.length, 0);
  } finally {
    delete process.env.CIRCUIT_SUPPRESS_RPC_WARNING;
  }
});

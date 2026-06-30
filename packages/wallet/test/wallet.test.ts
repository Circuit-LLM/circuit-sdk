import { test } from 'node:test';
import assert from 'node:assert';
import { Connection } from '@solana/web3.js';
import { Wallet } from '../src/wallet.ts';
import { keypairFromSecret, generateKeypair, isValidAddress, secretKeyBase58 } from '../src/keypair.ts';

function stubConn(opts: { sol?: number; circ?: string }): Connection {
  return {
    async getBalance() {
      return Math.round((opts.sol ?? 0) * 1e9);
    },
    async getTokenAccountBalance() {
      if (opts.circ == null) throw new Error('no ata');
      return { value: { amount: opts.circ } };
    },
  } as unknown as Connection;
}

test('keypairFromSecret parses base58 and byte-array forms', () => {
  const kp = generateKeypair();
  assert.ok(keypairFromSecret(secretKeyBase58(kp)).publicKey.equals(kp.publicKey));
  assert.ok(keypairFromSecret(JSON.stringify(Array.from(kp.secretKey))).publicKey.equals(kp.publicKey));
});

test('isValidAddress', () => {
  assert.equal(isValidAddress(generateKeypair().publicKey.toBase58()), true);
  assert.equal(isValidAddress('not-an-address'), false);
});

test('solBalance converts lamports to SOL', async () => {
  const kp = generateKeypair();
  const w = new Wallet({ keypair: kp, connection: stubConn({ sol: 1.5 }) });
  assert.equal(await w.solBalance(), 1.5);
  assert.equal(w.address, kp.publicKey.toBase58());
  assert.equal(w.readOnly, false);
});

test('circBalance reads the token account; 0 when no ATA exists', async () => {
  const kp = generateKeypair();
  const w = new Wallet({ keypair: kp, connection: stubConn({ circ: '5000000' }) }); // 5 CIRC @ 6 dec
  assert.equal(await w.circBalance(), 5);
  const w2 = new Wallet({ keypair: kp, connection: stubConn({}) });
  assert.equal(await w2.circBalance(), 0);
});

test('read-only wallet from an address has no keypair', () => {
  const addr = generateKeypair().publicKey.toBase58();
  const w = new Wallet({ address: addr, connection: stubConn({}) });
  assert.equal(w.readOnly, true);
  assert.equal(w.address, addr);
});

test('sendCirc without a keypair throws (read-only)', async () => {
  const w = new Wallet({ address: generateKeypair().publicKey.toBase58(), connection: stubConn({}) });
  await assert.rejects(() => w.sendCirc(generateKeypair().publicKey.toBase58(), 1n), /No wallet loaded/);
});

test('Wallet satisfies the PaymentWallet shape (sendCirc present)', () => {
  const w = new Wallet({ keypair: generateKeypair(), connection: stubConn({}) });
  assert.equal(typeof w.sendCirc, 'function');
});

test('withRpc fails over to the next RPC on a rate-limit error', async () => {
  let firstTried = false;
  const failing = {
    async getBalance() {
      firstTried = true;
      throw new Error('429 Too Many Requests');
    },
  } as unknown as Connection;
  const w = new Wallet({ keypair: generateKeypair(), connections: [failing, stubConn({ sol: 2 })] });
  assert.equal(await w.solBalance(), 2, 'falls over to the second RPC');
  assert.equal(firstTried, true, 'the primary was tried first');
});

test('sendCirc signs ONCE and re-broadcasts identical bytes on failover (no double-spend)', async () => {
  const kp = generateKeypair();
  const blockhash = generateKeypair().publicKey.toBase58(); // a valid 32-byte base58, usable as a blockhash
  const seenRaw: string[] = [];
  let bhCalls = 0;
  const mk = (send: () => string) =>
    ({
      async getLatestBlockhash() {
        bhCalls++;
        return { blockhash, lastValidBlockHeight: 1 };
      },
      async sendRawTransaction(raw: Uint8Array) {
        seenRaw.push(Buffer.from(raw).toString('base64'));
        return send();
      },
      async confirmTransaction() {
        return { value: { err: null } };
      },
    }) as unknown as Connection;
  const c1 = mk(() => {
    throw new Error('429 Too Many Requests'); // first RPC rate-limits the broadcast → failover
  });
  const c2 = mk(() => 'SIG');
  const w = new Wallet({ keypair: kp, connections: [c1, c2] });

  const sig = await w.sendCirc(generateKeypair().publicKey.toBase58(), 1000n);
  assert.equal(sig, 'SIG', 'failover returns the signature from the second RPC');
  assert.equal(seenRaw.length, 2, 'broadcast attempted on both RPCs');
  assert.equal(seenRaw[0], seenRaw[1], 'IDENTICAL signed bytes — signed once, never re-signed (no double-spend)');
  assert.equal(bhCalls, 1, 'blockhash fetched once, not per-send');
});

test('withRpc does NOT fail over on a real (non-rate-limit) error', async () => {
  const boom = {
    async getBalance() {
      throw new Error('invalid param: pubkey');
    },
  } as unknown as Connection;
  const w = new Wallet({ keypair: generateKeypair(), connections: [boom, stubConn({ sol: 9 })] });
  await assert.rejects(() => w.solBalance(), /invalid param/, 'a real error propagates, no silent failover');
});

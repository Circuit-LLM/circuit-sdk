import { test } from 'node:test';
import assert from 'node:assert';
import { Connection } from '@solana/web3.js';
import { Wallet } from '../src/wallet.ts';
import { InsufficientFundsError } from '../src/errors.ts';
import { keypairFromSecret, generateKeypair, isValidAddress, secretKeyBase58 } from '../src/keypair.ts';

// Every wallet here injects a connection, so the default-public-RPC warning never fires (keeps output clean).

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

// A connection that can drive a full send (blockhash → broadcast → confirm) and answer balance probes.
// `sendErr` makes the broadcast fail; `circ == null` means the sender has no CIRC ATA (never held CIRC).
function sendStub(opts: { circ?: string | null; sol?: number; sendErr?: Error }): Connection {
  const blockhash = generateKeypair().publicKey.toBase58(); // a valid 32-byte base58, usable as a blockhash
  return {
    async getLatestBlockhash() {
      return { blockhash, lastValidBlockHeight: 1 };
    },
    async sendRawTransaction() {
      if (opts.sendErr) throw opts.sendErr;
      return 'SIG';
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
    async getBalance() {
      return Math.round((opts.sol ?? 0) * 1e9);
    },
    async getTokenAccountBalance() {
      if (opts.circ == null) throw new Error('could not find account'); // genuinely-missing ATA
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

// --- Insufficient-funds classification: a failed send becomes a clear, typed error --------------------

test('sendCirc → InsufficientFundsError when the CIRC balance is too low', async () => {
  const w = new Wallet({
    keypair: generateKeypair(),
    connections: [sendStub({ circ: '500000', sol: 1, sendErr: new Error('Transfer: insufficient funds') })],
  });
  await assert.rejects(
    () => w.sendCirc(generateKeypair().publicKey.toBase58(), 1_000_000n),
    (e: unknown) => {
      assert.ok(e instanceof InsufficientFundsError, 'is InsufficientFundsError');
      assert.equal(e.token, 'CIRC');
      assert.equal(e.haveRaw, 500000n);
      assert.equal(e.needRaw, 1_000_000n);
      assert.match(e.message, /Insufficient CIRC: have 0\.5, need 1 CIRC/);
      return true;
    },
  );
});

test('sendCirc → insufficient CIRC (have 0) when the sender has no ATA', async () => {
  const w = new Wallet({
    keypair: generateKeypair(),
    connections: [sendStub({ circ: null, sol: 1, sendErr: new Error('custom program error: 0x1') })],
  });
  await assert.rejects(
    () => w.sendCirc(generateKeypair().publicKey.toBase58(), 10n),
    (e: unknown) => e instanceof InsufficientFundsError && e.token === 'CIRC' && e.haveRaw === 0n,
  );
});

test('sendCirc → InsufficientFundsError(SOL) when CIRC is fine but SOL for fees is ~0', async () => {
  const w = new Wallet({
    keypair: generateKeypair(),
    connections: [sendStub({ circ: '9000000', sol: 0, sendErr: new Error('blockhash expired') })],
  });
  await assert.rejects(
    () => w.sendCirc(generateKeypair().publicKey.toBase58(), 1_000_000n),
    (e: unknown) => e instanceof InsufficientFundsError && e.token === 'SOL' && e.haveRaw === 0n,
  );
});

test('sendCirc rethrows the ORIGINAL error when funds are sufficient', async () => {
  const w = new Wallet({
    keypair: generateKeypair(),
    connections: [sendStub({ circ: '9000000', sol: 5, sendErr: new Error('Blockhash not found') })],
  });
  await assert.rejects(
    () => w.sendCirc(generateKeypair().publicKey.toBase58(), 1_000_000n),
    (e: unknown) => !(e instanceof InsufficientFundsError) && /Blockhash not found/.test((e as Error).message),
  );
});

test('a failed balance probe never masks the real send error', async () => {
  const conn = {
    async getLatestBlockhash() {
      return { blockhash: generateKeypair().publicKey.toBase58(), lastValidBlockHeight: 1 };
    },
    async sendRawTransaction() {
      throw new Error('node is behind by 500 slots');
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
    async getTokenAccountBalance() {
      throw new Error('503 Service Unavailable'); // a real RPC failure, NOT a missing account
    },
    async getBalance() {
      return 1e9;
    },
  } as unknown as Connection;
  const w = new Wallet({ keypair: generateKeypair(), connections: [conn] });
  await assert.rejects(
    () => w.sendCirc(generateKeypair().publicKey.toBase58(), 1_000_000n),
    (e: unknown) => !(e instanceof InsufficientFundsError) && /node is behind/.test((e as Error).message),
  );
});

test('sendCirc does NOT probe balances on the happy path (no added latency)', async () => {
  let balanceProbed = false;
  const conn = {
    async getLatestBlockhash() {
      return { blockhash: generateKeypair().publicKey.toBase58(), lastValidBlockHeight: 1 };
    },
    async sendRawTransaction() {
      return 'OK';
    },
    async confirmTransaction() {
      return { value: { err: null } };
    },
    async getTokenAccountBalance() {
      balanceProbed = true;
      return { value: { amount: '0' } };
    },
    async getBalance() {
      balanceProbed = true;
      return 0;
    },
  } as unknown as Connection;
  const w = new Wallet({ keypair: generateKeypair(), connections: [conn] });
  assert.equal(await w.sendCirc(generateKeypair().publicKey.toBase58(), 1n), 'OK');
  assert.equal(balanceProbed, false, 'no extra RPC reads when the send succeeds');
});

test('sendSol → InsufficientFundsError(SOL) when balance < amount + fee', async () => {
  const w = new Wallet({
    keypair: generateKeypair(),
    connections: [sendStub({ sol: 0.001, sendErr: new Error('insufficient lamports') })],
  });
  await assert.rejects(
    () => w.sendSol(generateKeypair().publicKey.toBase58(), 1), // needs 1 SOL + fee, has 0.001
    (e: unknown) =>
      e instanceof InsufficientFundsError &&
      e.token === 'SOL' &&
      e.haveRaw === 1_000_000n &&
      e.needRaw === 1_000_000_000n + 5000n,
  );
});

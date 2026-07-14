// signAndSendTransaction must validate a server-built payment tx before signing it: allow only
// transfers to allow-listed programs, and — when an expected recipient is given — only to that recipient.
// A hostile/tampered tx (Approve, unknown program, wrong recipient) must be REFUSED before any signing.
import { test } from 'node:test';
import assert from 'node:assert';
import { Keypair, PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import {
  createTransferCheckedInstruction,
  createApproveInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';
import { Wallet } from '../src/wallet.ts';
import { TransactionUnconfirmedError } from '../src/errors.ts';

// A fake RPC so the accept-path doesn't touch the network: send returns a sig, confirm resolves.
const fakeConn = { sendRawTransaction: async () => 'FAKESIG', confirmTransaction: async () => ({ value: { err: null } }) };
const DUMMY_BLOCKHASH = '11111111111111111111111111111111'; // 32 zero bytes — a valid base58 blockhash

function makeWallet(kp: Keypair) {
  return new Wallet({ keypair: kp, connections: [fakeConn as never] });
}
function toB64(tx: Transaction, feePayer: PublicKey): string {
  tx.feePayer = feePayer;
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

const CIRC_MINT = new PublicKey('8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump');

test('accepts a plain SOL transfer to the expected recipient', async () => {
  const kp = Keypair.generate();
  const treasury = Keypair.generate().publicKey;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: treasury, lamports: 1000 }));
  const w = makeWallet(kp);
  const sig = await w.signAndSendTransaction(toB64(tx, kp.publicKey), { recipient: treasury.toBase58() });
  assert.equal(sig, 'FAKESIG');
});

test('accepts a Token-2022 TransferChecked to the recipient ATA', async () => {
  const kp = Keypair.generate();
  const treasury = Keypair.generate().publicKey;
  const fromAta = getAssociatedTokenAddressSync(CIRC_MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(CIRC_MINT, treasury, false, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction().add(
    createTransferCheckedInstruction(fromAta, CIRC_MINT, toAta, kp.publicKey, 1000n, 6, [], TOKEN_2022_PROGRAM_ID),
  );
  const w = makeWallet(kp);
  const sig = await w.signAndSendTransaction(toB64(tx, kp.publicKey), {
    recipient: treasury.toBase58(),
    mint: CIRC_MINT.toBase58(),
    tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
  });
  assert.equal(sig, 'FAKESIG');
});

test('REFUSES a SOL transfer to the wrong recipient', async () => {
  const kp = Keypair.generate();
  const treasury = Keypair.generate().publicKey;
  const attacker = Keypair.generate().publicKey;
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: attacker, lamports: 1000 }));
  const w = makeWallet(kp);
  await assert.rejects(
    () => w.signAndSendTransaction(toB64(tx, kp.publicKey), { recipient: treasury.toBase58() }),
    /refusing to sign: SOL transfer/,
  );
});

test('REFUSES a token Approve (delegate grant) — the standing-drain attack', async () => {
  const kp = Keypair.generate();
  const fromAta = getAssociatedTokenAddressSync(CIRC_MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const delegate = Keypair.generate().publicKey;
  const tx = new Transaction().add(
    createApproveInstruction(fromAta, delegate, kp.publicKey, 1_000_000_000n, [], TOKEN_2022_PROGRAM_ID),
  );
  const w = makeWallet(kp);
  await assert.rejects(
    () => w.signAndSendTransaction(toB64(tx, kp.publicKey), { recipient: 'x' }),
    /disallowed token instruction/,
  );
});

test('REFUSES a transaction that calls an unexpected program', async () => {
  const kp = Keypair.generate();
  const tx = new Transaction().add(
    new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [], data: Buffer.from([1, 2, 3]) }),
  );
  const w = makeWallet(kp);
  await assert.rejects(() => w.signAndSendTransaction(toB64(tx, kp.publicKey)), /unexpected program/);
});

test('validates even with no expected recipient (allow-list still applies)', async () => {
  const kp = Keypair.generate();
  const to = Keypair.generate().publicKey;
  // plain transfer, no recipient pin → accepted
  const ok = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports: 1 }));
  assert.equal(await makeWallet(kp).signAndSendTransaction(toB64(ok, kp.publicKey)), 'FAKESIG');
  // Approve with no recipient pin → still refused
  const fromAta = getAssociatedTokenAddressSync(CIRC_MINT, kp.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const bad = new Transaction().add(createApproveInstruction(fromAta, to, kp.publicKey, 1n, [], TOKEN_2022_PROGRAM_ID));
  await assert.rejects(() => makeWallet(kp).signAndSendTransaction(toB64(bad, kp.publicKey)), /disallowed token instruction/);
});

test('throws TransactionUnconfirmedError (carrying the sig) when confirm fails but send succeeded', async () => {
  const kp = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const conn = { sendRawTransaction: async () => 'SENTSIG', confirmTransaction: async () => { throw new Error('timeout polling'); } };
  const w = new Wallet({ keypair: kp, connections: [conn as never] });
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: to, lamports: 1 }));
  await assert.rejects(
    () => w.signAndSendTransaction(toB64(tx, kp.publicKey)),
    (e: unknown) => e instanceof TransactionUnconfirmedError && e.signature === 'SENTSIG',
  );
});

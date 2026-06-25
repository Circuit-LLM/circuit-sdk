import { test } from 'node:test';
import assert from 'node:assert';
import {
  circReceived,
  verifyPaymentTx,
  MemoryReplayStore,
  type ParsedTx,
  type ParsedTxConnection,
} from '../src/verify.ts';
import { CIRC_MINT } from '../src/constants.ts';

function tx(opts: { received?: bigint; treasury?: string; blockTime?: number | null; err?: unknown } = {}): ParsedTx {
  const treasury = opts.treasury ?? 'TREASURY';
  const recv = opts.received ?? 300_000_000n;
  return {
    blockTime: opts.blockTime ?? null,
    meta: {
      err: opts.err ?? null,
      preTokenBalances: [{ accountIndex: 1, mint: CIRC_MINT, owner: treasury, uiTokenAmount: { amount: '0' } }],
      postTokenBalances: [
        { accountIndex: 1, mint: CIRC_MINT, owner: treasury, uiTokenAmount: { amount: recv.toString() } },
      ],
    },
  };
}
function conn(t: ParsedTx | null): ParsedTxConnection {
  return { async getParsedTransaction() { return t; } };
}

test('circReceived diffs post − pre for the treasury owner', () => {
  assert.equal(circReceived(tx({ received: 50_000_000n }), 'TREASURY'), 50_000_000n);
  assert.equal(circReceived(tx({ received: 50_000_000n }), 'OTHER'), 0n); // wrong owner → 0
});

test('verifyPaymentTx succeeds when payment covers the requirement', async () => {
  const r = await verifyPaymentTx('SIG', 300_000_000n, { connection: conn(tx()), treasury: 'TREASURY' });
  assert.equal(r.received, 300_000_000n);
  assert.equal(r.required, 300_000_000n);
});

test('verifyPaymentTx rejects an insufficient payment', async () => {
  await assert.rejects(
    () => verifyPaymentTx('SIG', 300_000_000n, { connection: conn(tx({ received: 1_000_000n })), treasury: 'TREASURY' }),
    /Insufficient/,
  );
});

test('verifyPaymentTx rejects a failed transaction', async () => {
  await assert.rejects(
    () => verifyPaymentTx('SIG', 1n, { connection: conn(tx({ err: { InstructionError: [0, 'x'] } })), treasury: 'TREASURY' }),
    /failed on chain/,
  );
});

test('verifyPaymentTx rejects a not-found transaction', async () => {
  await assert.rejects(
    () => verifyPaymentTx('SIG', 1n, { connection: conn(null), treasury: 'TREASURY', retries: 1 }),
    /not found/,
  );
});

test('verifyPaymentTx rejects a too-old transaction', async () => {
  await assert.rejects(
    () =>
      verifyPaymentTx('SIG', 1n, {
        connection: conn(tx({ blockTime: 1000 })), // 1000s → 1_000_000ms
        treasury: 'TREASURY',
        now: () => 1_000_000 + 6 * 60_000, // 6 min later → outside the 5-min window
      }),
    /too old/,
  );
});

test('verifyPaymentTx replay guard rejects signature reuse', async () => {
  const replay = new MemoryReplayStore();
  const opts = { connection: conn(tx()), treasury: 'TREASURY', replay };
  await verifyPaymentTx('SIG', 300_000_000n, opts);
  await assert.rejects(() => verifyPaymentTx('SIG', 300_000_000n, opts), /already used/);
});

// Typed wallet errors. Kept dependency-free so any consumer can `instanceof`-check them.

const DECIMALS = { CIRC: 6, SOL: 9 } as const;

/** Format a raw base-unit amount for display, without locale/precision surprises (deterministic). */
function formatAmount(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toString();
  if (frac > 0n) out += `.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
  return negative ? `-${out}` : out;
}

/**
 * Thrown when a transfer fails because the wallet is underfunded — instead of the opaque Solana
 * transaction error the RPC returns. `haveRaw`/`needRaw` are base units (CIRC: 6 decimals; SOL: lamports).
 */
export class InsufficientFundsError extends Error {
  readonly token: 'CIRC' | 'SOL';
  readonly haveRaw: bigint;
  readonly needRaw: bigint;

  constructor(token: 'CIRC' | 'SOL', haveRaw: bigint, needRaw: bigint) {
    const d = DECIMALS[token];
    super(
      `Insufficient ${token}: have ${formatAmount(haveRaw, d)}, need ${formatAmount(needRaw, d)} ${token}. ` +
        `Fund the wallet and retry.`,
    );
    this.name = 'InsufficientFundsError';
    this.token = token;
    this.haveRaw = haveRaw;
    this.needRaw = needRaw;
  }
}

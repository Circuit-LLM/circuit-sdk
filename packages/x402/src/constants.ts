// CIRC + x402 constants (mirrors circuit-data-api/middleware/x402.js).

export const CIRC_MINT = '8fQgfsRnRkKSeNUhevT7wp8mhNvMSJdLn1fJi4oVpump';
export const CIRC_TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const CIRC_DECIMALS = 6;

/** A payment signature is single-use and expires this long after the tx timestamp. */
export const MAX_TX_AGE_MS = 5 * 60_000;

export const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v3';
/** Deep fallback CIRC/USD only when the oracle is down AND no last-known price is fresh. */
export const FALLBACK_CIRC_USD = 0.0001;

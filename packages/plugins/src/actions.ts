// Framework-neutral action catalog for Circuit data. Both the ElizaOS plugin and the
// Solana Agent Kit adapter are thin shells over this — one place defines what an agent
// can ask Circuit for, one place handles x402 payment (via @circuit-llm/data). Add an
// endpoint here and it appears in every framework adapter automatically.

import { Data, type DataOptions } from '@circuit-llm/data';

export interface CircuitActionsOptions extends DataOptions {
  /**
   * Which actions to expose. 'free' (default) = only endpoints that cost no CIRC —
   * safe for an agent with no funded wallet. 'all' = the full catalog, where paid
   * endpoints will spend CIRC via x402 (a wallet + budget must be configured).
   */
  tier?: 'free' | 'all';
}

export interface CircuitAction {
  name: string;
  /** true when the endpoint may cost CIRC (agent needs a funded wallet + x402). */
  paid: boolean;
  description: string;
  /** JSON-schema-ish param spec, reused to build each framework's tool definition. */
  params: Record<string, { type: 'string' | 'number'; required?: boolean; description: string }>;
  run: (data: Data, args: Record<string, unknown>) => Promise<unknown>;
}

const S = (description: string, required = false) => ({ type: 'string' as const, required, description });

/** The canonical action list. `data` is a configured @circuit-llm/data client. */
export const CIRCUIT_ACTIONS: CircuitAction[] = [
  // ── free ──────────────────────────────────────────────────────────────────
  {
    name: 'circuit_token_price',
    paid: false,
    description: 'Live USD price for a Solana token by mint address, from the Circuit price feed. Free.',
    params: { mint: S('Token mint address (base58)', true) },
    run: (d, a) => d.prices(String(a.mint)),
  },
  {
    name: 'circuit_trending',
    paid: false,
    description: 'Trending Solana tokens by on-chain activity. Free.',
    params: {},
    run: (d) => d.tokenTrending(),
  },
  {
    name: 'circuit_market_regime',
    paid: false,
    description: 'Current Solana market regime (bull/bear/sideways/volatile) from on-chain momentum + Fear & Greed. Free.',
    params: {},
    run: (d) => d.marketRegime(),
  },
  {
    name: 'circuit_new_tokens',
    paid: false,
    description: 'Recently launched Solana tokens (pump.fun / Token-2022). Free.',
    params: {},
    run: (d) => d.newTokens(),
  },
  // ── paid (x402 CIRC) ────────────────────────────────────────────────────────
  {
    name: 'circuit_token_info',
    paid: true,
    description: 'Full token profile: metadata, security/rug verdict, holder concentration, pools. Costs micro-CIRC via x402.',
    params: { mint: S('Token mint address', true) },
    run: (d, a) => d.tokenInfo(String(a.mint)),
  },
  {
    name: 'circuit_token_security',
    paid: true,
    description: 'Security audit for a token: authorities, LP lock, rug risk flags, top-holder %. Costs micro-CIRC.',
    params: { mint: S('Token mint address', true) },
    run: (d, a) => d.tokenSecurity(String(a.mint)),
  },
  {
    name: 'circuit_token_holders',
    paid: true,
    description: 'Holder concentration analysis for a token (whale risk). Costs micro-CIRC.',
    params: { mint: S('Token mint address', true) },
    run: (d, a) => d.tokenHolders(String(a.mint)),
  },
  {
    name: 'circuit_market_overview',
    paid: true,
    description: 'Unified Solana market snapshot: SOL price, Fear & Greed, TVL, trending, activity. Costs micro-CIRC.',
    params: {},
    run: (d) => d.marketOverview(),
  },
  {
    name: 'circuit_wallet_analytics',
    paid: true,
    description: 'Portfolio health analytics for any wallet: concentration, diversification, risk exposure. Costs micro-CIRC.',
    params: { wallet: S('Wallet address', true) },
    run: (d, a) => d.walletAnalytics(String(a.wallet)),
  },
  {
    name: 'circuit_token_ohlcv',
    paid: true,
    description: 'OHLCV candles for a token. Costs micro-CIRC.',
    params: {
      mint:   S('Token mint address', true),
      window: S('Candle window: 1m|5m|1h|1d (default 1h)'),
    },
    run: (d, a) => d.tokenOhlcv(String(a.mint), { window: a.window ? String(a.window) : undefined }),
  },
];

/** Build a configured Data client + the selected action subset. */
export function circuitActions(opts: CircuitActionsOptions = {}): { data: Data; actions: CircuitAction[] } {
  const data = new Data(opts);
  const tier = opts.tier ?? 'free';
  const actions = tier === 'all' ? CIRCUIT_ACTIONS : CIRCUIT_ACTIONS.filter((a) => !a.paid);
  return { data, actions };
}

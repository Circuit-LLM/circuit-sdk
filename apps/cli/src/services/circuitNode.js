// circuit-node client. The swarm registry is public (api.circuitllm.xyz);
// market/network data is x402-gated for non-localhost, so it's only free via the
// local port on the coordinator host. Each method tries bases in priority order.
import { config } from '../config.js';
import { getJson } from './http.js';

const PUBLIC = () => config.endpoints.nodePublic;
const LOCAL = () => config.endpoints.node;

async function tryBases(bases, path, opts) {
  let last;
  for (const base of bases.filter(Boolean)) {
    try {
      return await getJson(base.replace(/\/$/, '') + path, opts);
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export const circuitNode = {
  // Swarm registry — public first (works for any user), local fallback.
  swarmStats: () => tryBases([PUBLIC(), LOCAL()], '/api/swarm/stats', { timeout: 6000 }),
  swarmLeaderboard: () => tryBases([PUBLIC(), LOCAL()], '/api/swarm/leaderboard', { timeout: 6000 }),
  // feed-public: free, capped (newest ≤200), identical shape to the x402-gated /feed. The CLI is a
  // free public client, so it reads the public feed — the paid /feed is for paying agents. (Using
  // /feed here 402'd, then fell back to localhost and surfaced as "fetch failed".)
  swarmFeed: (limit = 50) => tryBases([PUBLIC(), LOCAL()], `/api/swarm/feed-public?limit=${limit}`, { timeout: 6000 }),
  swarmHoldings: () => tryBases([PUBLIC(), LOCAL()], '/api/swarm/holdings', { timeout: 6000 }),

  // Node network/health probe — local first (the coordinator host), public as a fallback probe.
  // Market data (trending / losers / scan / active) now comes FREE from the price-feed — see
  // services/priceFeed.js — so those older paid/local-first routes were removed.
  network: () => tryBases([LOCAL(), PUBLIC()], '/api/network', { timeout: 6000 }),
};

// Node onboarding — the one-line GPU installer and (best-effort) payouts.
import { config } from '../config.js';

export const node = {
  joinCommand: () => `curl -fsSL ${config.endpoints.join} | bash`,

  async joinScript() {
    const r = await fetch(config.endpoints.join, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`join installer unavailable (${r.status})`);
    return r.text();
  },
};

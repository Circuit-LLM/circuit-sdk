// Shared runtime context — built once per run. Carries config + live status.
import { config } from '../config.js';

export async function buildContext() {
  let online = false;
  try {
    const r = await fetch(config.endpoints.health, { signal: AbortSignal.timeout(2500) });
    online = r.ok;
  } catch {
    online = false;
  }
  return { config, status: { online } };
}

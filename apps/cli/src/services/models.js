// Models service — the circuitllm.xyz/models gateway (buy credits, mint a key, metered OpenAI chat).
//
// Backed by @circuit-llm/models. The signing wallet comes from the CLI keystore (services/wallet.js),
// same as everywhere else. The issued `sk-circuit-` key is a secret, so — unlike ~/.circuit/config.json —
// it lives in its own 0600 file (or the CIRCUIT_MODELS_KEY env var), never in the plain user config.
import fs from 'node:fs';
import path from 'node:path';
import { Models } from '@circuit-llm/models';
import { makeWallet } from './wallet.js';
import { HOME_DIR } from '../config.js';

export const MODELS_KEY_FILE = path.join(HOME_DIR, 'models-key.json');

// Default chat model. Override with -m/--model or CIRCUIT_MODELS_MODEL. The gateway resells OpenRouter,
// so this is an OpenRouter model id; `circuit models list` shows what's available.
export const DEFAULT_MODEL = process.env.CIRCUIT_MODELS_MODEL || 'openai/gpt-4o-mini';

/** The stored `sk-circuit-` key, or null. Env wins over the key file. */
export function loadModelsKey() {
  if (process.env.CIRCUIT_MODELS_KEY) return { circuitKey: process.env.CIRCUIT_MODELS_KEY, source: 'env' };
  try {
    const j = JSON.parse(fs.readFileSync(MODELS_KEY_FILE, 'utf8'));
    if (j.circuitKey) return { ...j, source: 'file' };
  } catch {
    /* none saved */
  }
  return null;
}

/** Persist an issued key to ~/.circuit/models-key.json, readable only by the owner (0600). */
export function saveModelsKey(data) {
  fs.mkdirSync(HOME_DIR, { recursive: true });
  fs.writeFileSync(MODELS_KEY_FILE, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  try {
    fs.chmodSync(MODELS_KEY_FILE, 0o600);
  } catch {
    /* best effort (e.g. Windows) */
  }
  return MODELS_KEY_FILE;
}

/** Build a Models client. `wallet` attaches the signing wallet (account/purchase); `key` attaches the
 *  stored sk-circuit key (chat). */
export function makeModels({ wallet = false, key = false, model } = {}) {
  const opts = { baseUrl: process.env.CIRCUIT_MODELS_URL || undefined, model: model || DEFAULT_MODEL };
  if (wallet) opts.wallet = makeWallet();
  if (key) {
    const k = loadModelsKey();
    if (k) opts.apiKey = k.circuitKey;
  }
  return new Models(opts);
}

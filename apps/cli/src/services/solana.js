// Solana primitives — connection, keypair loading, Circuit token constants.
// The keypair is optional: read paths work with just an address.
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import { config, HOME_DIR, WALLET_FILE, CIRC, SOL_MINT } from '../config.js';

export const PK = {
  circMint: new PublicKey(CIRC.mint),
  token2022: new PublicKey(CIRC.tokenProgram),
  sol: new PublicKey(SOL_MINT),
};

export function getConnection(rpcUrl = config.rpcUrl) {
  return new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
}

// Public RPCs tried (in order) when the primary hits its rate limit / credit cap.
export const FALLBACK_RPCS = ['https://api.mainnet-beta.solana.com', 'https://rpc.ankr.com/solana'];

export function getConnections(rpcUrl = config.rpcUrl) {
  const urls = [rpcUrl, ...FALLBACK_RPCS].filter((u, i, a) => u && a.indexOf(u) === i);
  return urls.map((u) => new Connection(u, { commitment: 'confirmed', disableRetryOnRateLimit: true }));
}

const isRateLimited = (e) => /429|Too Many Requests|max usage|rate limit/i.test(e?.message || '');

// Run fn(connection) against each RPC in turn. Advance to the next RPC on a
// rate-limit error OR a stall (per-try timeout) — a capped RPC sometimes hangs
// rather than throwing. Re-broadcasting a signed tx is idempotent (fixed
// signature), so the timeout fallback is safe for sends as well as reads.
export async function withRpc(connections, fn, { perTryMs = 25000 } = {}) {
  let last;
  for (const conn of connections) {
    try {
      return await Promise.race([
        fn(conn),
        new Promise((_, reject) =>
          setTimeout(() => reject(Object.assign(new Error('rpc timeout'), { _timeout: true })), perTryMs),
        ),
      ]);
    } catch (e) {
      last = e;
      if (!isRateLimited(e) && !e?._timeout) throw e;
    }
  }
  throw last;
}

// Load the signing keypair from CIRCUIT_WALLET (base58) or ~/.circuit/id.json
// (Solana byte-array format). Returns null when neither is present.
export function loadKeypair() {
  const env = process.env.CIRCUIT_WALLET;
  if (env) {
    try {
      return Keypair.fromSecretKey(bs58.decode(env.trim()));
    } catch {
      throw new Error('CIRCUIT_WALLET is set but is not a valid base58 secret key');
    }
  }
  try {
    const raw = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  } catch {
    return null;
  }
}

// Report WHERE the active signing key comes from + the address it resolves to, so the UI can be
// transparent about it. CIRCUIT_WALLET (env) takes precedence over the saved keyfile — when BOTH
// exist, the env SILENTLY overrides the wallet a user "connected" (saved to id.json). `overridesFile`
// flags exactly that case so we can warn instead of showing a surprising balance.
export function walletSource() {
  const hasFile = fs.existsSync(WALLET_FILE);
  if (process.env.CIRCUIT_WALLET) {
    let address = null;
    try { address = Keypair.fromSecretKey(bs58.decode(process.env.CIRCUIT_WALLET.trim())).publicKey.toString(); } catch {}
    return { source: 'env', label: 'CIRCUIT_WALLET env', address, overridesFile: hasFile };
  }
  if (hasFile) {
    let address = null;
    try { address = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8')))).publicKey.toString(); } catch {}
    return { source: 'file', label: '~/.circuit/id.json', address, overridesFile: false };
  }
  return { source: 'none', label: null, address: null, overridesFile: false };
}

export function isValidAddress(s) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(s);
    return true;
  } catch {
    return false;
  }
}

// ── Keystore ─────────────────────────────────────────────────────────────────
// The wallet is stored as a Solana keyfile (byte array) at ~/.circuit/id.json,
// owner-only (0600), same format as solana-keygen. Unencrypted at rest — an
// encrypted keystore is a planned enhancement.

export function walletExists() {
  return !!process.env.CIRCUIT_WALLET || fs.existsSync(WALLET_FILE);
}

export function generateKeypair() {
  return Keypair.generate();
}

// Accept a base58 secret key OR a JSON byte array.
export function keypairFromInput(input) {
  const s = String(input).trim();
  if (s.startsWith('[')) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  return Keypair.fromSecretKey(bs58.decode(s));
}

export function saveKeypair(keypair) {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(WALLET_FILE, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  try {
    fs.chmodSync(WALLET_FILE, 0o600);
  } catch {
    /* best-effort on platforms without chmod */
  }
  return WALLET_FILE;
}

export const secretKeyBase58 = (keypair) => bs58.encode(keypair.secretKey);

export { PublicKey, Keypair };

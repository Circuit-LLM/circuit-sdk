// services/bundle.js — publish an agent as a content-addressed, signed bundle (AGENT_BUNDLES.md §2-3).
//
// The format MUST stay byte-identical to circuit-agent-cloud/lib/bundle.js, or a node/control-plane
// will reject what we publish: same canonical manifest signing bytes, same Ed25519 over them, same
// base58, same sha256 of the tarball. (Cross-repo consistency is locked by a test.)
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import bs58 from 'bs58';
import { loadKeypair } from './solana.js';

export const BUNDLE_SCHEMA = 1;

// Ed25519 PKCS8 framing (RFC 8410) — reconstruct a signing key from a Solana keypair's 32-byte seed.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

// MUST stay byte-identical to circuit-agent-cloud/lib/bundle.js manifestSigningBytes (locked by a test).
function canonResources(r) {
  return r ? { maxCpu: r.maxCpu ?? null, maxMemoryMb: r.maxMemoryMb ?? null } : null;
}
export function manifestSigningBytes(m) {
  const canon = {
    agentId: m.agentId,
    egress: Array.isArray(m.egress) ? [...m.egress].sort() : [],
    entry: m.entry,
    resources: canonResources(m.resources),
    runtime: m.runtime,
    schema: BUNDLE_SCHEMA,
    sdk: m.sdk ?? null,
    sha256: m.sha256,
  };
  return Buffer.from(JSON.stringify(canon));
}

const isSafeEntry = (e) => typeof e === 'string' && /^[\w][\w.-]*$/.test(e) && e !== '.' && e !== '..' && !e.includes('/');

function signWithSeed(seed32, msg) {
  const priv = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed32)]), format: 'der', type: 'pkcs8' });
  return crypto.sign(null, Buffer.from(msg), priv); // null algo == Ed25519
}

const sha256hex = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── what NEVER goes in a bundle ───────────────────────────────────────────────────────────────
// A bundle is content-addressed, signed, and pulled onto an UNTRUSTED host, then unpacked and run.
// So secrets must never ride along — they reach the agent out-of-band (runtime env, injected by the
// owner at launch). We hard-exclude VCS + deps (reinstalled on the node) + anything secret-shaped,
// AND honour the project's .gitignore / .circuitignore. Excludes are final (a leading `!` un-ignore
// is deliberately NOT honoured — we never re-include something an ignore rule pushed out).
const ALWAYS_IGNORE = ['.git/', 'node_modules/', '.hg/', '.svn/', '.DS_Store', 'Thumbs.db', '*.log'];
const SECRET_IGNORE = [
  '.env', '.env.*', '*.env',
  '*.pem', '*.key', '*.p12', '*.pfx',
  'id.json', 'id_*.json', '*keypair*.json', '*keypair*', 'wallet.json', '*.wallet',
  '.npmrc', '.netrc', 'secrets.json', 'secrets.*', '.secrets/', '.ssh/', '.aws/', '.gnupg/', '.circuit/',
];

const _reCache = new Map();
function globRe(glob) {
  let re = _reCache.get(glob);
  if (re) return re;
  let body = '';
  for (const ch of glob) {
    if (ch === '*') body += '[^/]*';
    else if (ch === '?') body += '[^/]';
    else body += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  re = new RegExp(`^${body}$`);
  _reCache.set(glob, re);
  return re;
}
// gitignore-ish match: no-slash patterns match a basename anywhere; slash patterns match the rel path.
function matchAny(rel, name, patterns) {
  for (const raw of patterns) {
    let p = (raw || '').trim();
    if (!p || p.startsWith('#') || p.startsWith('!')) continue;
    if (p.endsWith('/')) p = p.slice(0, -1);
    if (p.startsWith('/')) p = p.slice(1);
    if (!p) continue;
    if (p.includes('/')) {
      if (globRe(p).test(rel) || rel === p || rel.startsWith(`${p}/`)) return true;
    } else if (globRe(p).test(name)) {
      return true;
    }
  }
  return false;
}
function readIgnore(dir, file) {
  try { return fs.readFileSync(path.join(dir, file), 'utf8').split('\n'); }
  catch { return []; }
}

// Walk dir → { files: sorted rel paths to include, excludedSecrets: secret-shaped paths skipped }.
function listIncluded(dir) {
  const userIgnore = [...readIgnore(dir, '.gitignore'), ...readIgnore(dir, '.circuitignore')];
  const files = [];
  const excludedSecrets = [];
  (function rec(cur, rel) {
    let names;
    try { names = fs.readdirSync(cur).sort(); } catch { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      let st;
      try { st = fs.lstatSync(path.join(cur, name)); } catch { continue; }
      if (st.isSymbolicLink()) continue; // never follow/include symlinks (could point at secrets)
      if (matchAny(r, name, SECRET_IGNORE)) { excludedSecrets.push(r + (st.isDirectory() ? '/' : '')); continue; }
      if (matchAny(r, name, ALWAYS_IGNORE)) continue;
      if (matchAny(r, name, userIgnore)) continue;
      if (st.isDirectory()) rec(path.join(cur, name), r);
      else if (st.isFile()) files.push(r);
    }
  })(dir, '');
  return { files: files.sort(), excludedSecrets };
}

// ── Deterministic, cross-platform tar+gzip ─────────────────────────────────────────────────────
// We DON'T shell out to the system `tar`: Windows (and macOS) ship bsdtar, which rejects the GNU
// --sort/--mtime/--numeric-owner flags this used to rely on ("Option --sort=name is not supported").
// Instead we emit a plain USTAR archive of the already-sorted file list — zeroed uid/gid/mtime,
// normalized 0644 mode — then gzip with a zeroed header. Same content → same sha256 on any OS, and a
// node extracts it with a standard `tar -xzf` (only the GNU CREATE flags were the problem; extract is
// portable). The tarball never needs to be byte-identical to circuit-agent-cloud — its verifier only
// checks that the bytes hash to the signed manifest.sha256, not how they were packed.
function ustarHeader(name, size, mode = 0o644) {
  const buf = Buffer.alloc(512);
  let nm = name, prefix = '';
  if (Buffer.byteLength(nm) > 100) {
    let split = -1;
    for (let p = nm.indexOf('/'); p !== -1; p = nm.indexOf('/', p + 1)) {
      if (Buffer.byteLength(nm.slice(p + 1)) <= 100 && Buffer.byteLength(nm.slice(0, p)) <= 155) { split = p; break; }
    }
    if (split === -1) throw new Error(`path too long to bundle (USTAR limit): ${name}`);
    prefix = nm.slice(0, split);
    nm = nm.slice(split + 1);
  }
  buf.write(nm, 0, 100, 'utf8');
  buf.write((mode & 0o7777).toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii'); // mode
  buf.write('0000000\0', 108, 8, 'ascii');                                          // uid 0
  buf.write('0000000\0', 116, 8, 'ascii');                                          // gid 0
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');           // size
  buf.write('00000000000\0', 136, 12, 'ascii');                                     // mtime 0
  buf.write('        ', 148, 8, 'ascii');                                            // chksum: spaces for the sum
  buf.write('0', 156, 1, 'ascii');                                                   // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii');                                            // magic
  buf.write('00', 263, 2, 'ascii');                                                 // version
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write((sum & 0o777777).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii'); // 6 octal + NUL + space
  return buf;
}

function tarGzip(dir, files) {
  const blocks = [];
  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel)); // rel is already '/'-separated (see listIncluded)
    blocks.push(ustarHeader(rel, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  const gz = zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
  gz.writeUInt32LE(0, 4); // zero the gzip header MTIME (bytes 4-7) …
  gz[9] = 0xff;           // … and the OS byte, so output is identical across machines/OSes
  return gz;
}

function packDir(dir) {
  const { files, excludedSecrets } = listIncluded(dir);
  if (!files.length) throw new Error('nothing to bundle — every file was excluded by ignore rules');
  return { bytes: tarGzip(dir, files), files, excludedSecrets };
}

// The local content-addressed store (B1 own-fleet backend). On a shared fs the node reads it directly;
// a real deployment swaps in object storage / a CDN behind the same {sha}.tgz / {sha}.manifest.json shape.
export function storeRoot() {
  return process.env.CIRCUIT_BUNDLE_STORE || path.join(os.homedir(), '.circuit', 'bundles');
}

/**
 * Build + sign + store a bundle from a source directory.
 * @returns {{ ref, url, sha256, runtime, manifest }} the bundle block to attach to an agent spec.
 */
export function publishDir({ dir, agentId, entry = 'agent.js', sdk = null, runtime = 'node', egress = [], resources = null }) {
  if (runtime !== 'node' && runtime !== 'oci') throw new Error(`unknown runtime '${runtime}'`);
  if (!isSafeEntry(entry)) throw new Error(`unsafe entry '${entry}'`);
  if (!fs.existsSync(path.join(dir, entry))) throw new Error(`entry '${entry}' not found in ${dir}`);
  const kp = loadKeypair();
  if (!kp) throw new Error('no wallet — set a Circuit wallet to publish (the publisher must be the agent owner)');

  const { bytes, files, excludedSecrets } = packDir(dir);
  const sha256 = sha256hex(bytes);
  const manifest = {
    schema: BUNDLE_SCHEMA, agentId, runtime, entry, sdk, egress, resources, sha256,
    publisherPubkey: kp.publicKey.toBase58(),
  };
  manifest.sig = bs58.encode(signWithSeed(kp.secretKey.slice(0, 32), manifestSigningBytes(manifest)));

  const root = storeRoot();
  fs.mkdirSync(root, { recursive: true });
  const tgz = path.join(root, `${sha256}.tgz`);
  fs.writeFileSync(tgz, bytes);
  fs.writeFileSync(path.join(root, `${sha256}.manifest.json`), JSON.stringify(manifest));
  // fileCount + excludedSecrets let the caller show what shipped and what was deliberately held back
  // (secrets never go in the bundle — the owner injects them as runtime env on the node).
  return { ref: `bundle://${sha256}`, url: tgz, sha256, runtime, manifest, fileCount: files.length, excludedSecrets };
}

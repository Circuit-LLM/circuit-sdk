// Content-addressed agent bundles (AGENT_BUNDLES.md §2). Ported from circuit-agent-cloud/lib/bundle.js.
//
// A bundle is a gzipped tarball of a built agent. Its sha256 IS its identity, so a node runs exactly
// the bytes that were published and a reschedule pulls the same bytes. A signed MANIFEST binds the
// bytes (sha256), the target agentId, and the entry to a publisher key — and at bind time the control
// plane checks that publisher == the agent's owner (so "signed" means "signed by someone allowed").
//
//   createBundle({ dir, agentId, entry, sdk, priv, publisherPubkey }) -> { bytes, sha256, manifest }
//   verifyBundle(bytes, manifest, { expectedOwner })                  -> { ok, code }
//   unpackTo(bytes, destDir)                                          -> entry path on disk
//
// This is the CANONICAL codec. circuit-agent-cloud/lib/bundle.js and circuit-cli/src/services/bundle.js
// must produce byte-identical manifestSigningBytes + signatures (see crypto.ts). The golden vectors in
// test/bundle.test.ts pin that contract.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { sign, verify, base58, base58decode, sha256hex } from './crypto.ts';

export const BUNDLE_SCHEMA = 1;

export type BundleRuntime = 'node' | 'oci';

export interface BundleResources {
  maxCpu?: number | null;
  maxMemoryMb?: number | null;
}

export interface BundleManifest {
  schema: number;
  agentId: string;
  runtime: BundleRuntime;
  entry: string;
  sdk: string | null;
  egress: string[];
  resources: BundleResources | null;
  sha256: string;
  publisherPubkey: string;
  sig?: string;
}

export interface VerifyBundleResult {
  ok: boolean;
  code?: 'sha256-mismatch' | 'bad-manifest-sig' | 'publisher-not-owner' | 'agent-id-mismatch' | 'bad-entry';
}

// The canonical bytes a publisher signs: the fields they commit to, in fixed (sorted-key) order. This
// MUST stay byte-identical to circuit-cli/src/services/bundle.js + circuit-agent-cloud/lib/bundle.js.
// publisherPubkey is NOT signed (the sig is verified *against* it; substituting it invalidates the sig)
// and the owner-binding ties that key to the owner. egress + resources ARE signed — the node uses them
// to set the allowlist + resource cap, so they must not be mutable on a still-valid signature.
export function canonResources(r: BundleResources | null | undefined): BundleResources | null {
  return r ? { maxCpu: r.maxCpu ?? null, maxMemoryMb: r.maxMemoryMb ?? null } : null;
}

export function manifestSigningBytes(m: BundleManifest): Buffer {
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

export function signManifest(m: BundleManifest, priv: crypto.KeyObject): string {
  return base58(sign(priv, manifestSigningBytes(m)));
}

export function verifyManifest(m: BundleManifest): boolean {
  if (!m || !m.sig || !m.publisherPubkey) return false;
  try {
    return verify(base58decode(m.publisherPubkey), manifestSigningBytes(m), base58decode(m.sig));
  } catch {
    return false;
  }
}

// ── what NEVER goes in a bundle ─────────────────────────────────────────────────────────────────
// A bundle is content-addressed, signed, and pulled onto an UNTRUSTED host, then unpacked and run. So
// secrets must never ride along — they reach the agent out-of-band (runtime env, injected by the owner).
// We hard-exclude VCS + deps + anything secret-shaped, AND honor the project's .gitignore/.circuitignore.
// Excludes are final (a leading `!` un-ignore is deliberately NOT honored). Ported from circuit-cli.
const ALWAYS_IGNORE = ['.git/', 'node_modules/', '.hg/', '.svn/', '.DS_Store', 'Thumbs.db', '*.log'];
const SECRET_IGNORE = [
  '.env', '.env.*', '*.env',
  '*.pem', '*.key', '*.p12', '*.pfx',
  'id.json', 'id_*.json', '*keypair*.json', '*keypair*', 'wallet.json', '*.wallet',
  '.npmrc', '.netrc', 'secrets.json', 'secrets.*', '.secrets/', '.ssh/', '.aws/', '.gnupg/', '.circuit/',
];

const _reCache = new Map<string, RegExp>();
function globRe(glob: string): RegExp {
  const cached = _reCache.get(glob);
  if (cached) return cached;
  let body = '';
  for (const ch of glob) {
    if (ch === '*') body += '[^/]*';
    else if (ch === '?') body += '[^/]';
    else body += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const re = new RegExp(`^${body}$`);
  _reCache.set(glob, re);
  return re;
}
// gitignore-ish match: no-slash patterns match a basename anywhere; slash patterns match the rel path.
function matchAny(rel: string, name: string, patterns: string[]): boolean {
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
function readIgnore(dir: string, file: string): string[] {
  try { return fs.readFileSync(path.join(dir, file), 'utf8').split('\n'); }
  catch { return []; }
}

// Walk dir → { files: sorted rel paths to include, excludedSecrets: secret-shaped paths skipped }.
function listIncluded(dir: string): { files: string[]; excludedSecrets: string[] } {
  const userIgnore = [...readIgnore(dir, '.gitignore'), ...readIgnore(dir, '.circuitignore')];
  const files: string[] = [];
  const excludedSecrets: string[] = [];
  const rec = (cur: string, rel: string): void => {
    let names: string[];
    try { names = fs.readdirSync(cur).sort(); } catch { return; }
    for (const name of names) {
      const r = rel ? `${rel}/${name}` : name;
      let st: fs.Stats;
      try { st = fs.lstatSync(path.join(cur, name)); } catch { continue; }
      if (st.isSymbolicLink()) continue; // never follow/include symlinks (could point at secrets)
      if (matchAny(r, name, SECRET_IGNORE)) { excludedSecrets.push(r + (st.isDirectory() ? '/' : '')); continue; }
      if (matchAny(r, name, ALWAYS_IGNORE)) continue;
      if (matchAny(r, name, userIgnore)) continue;
      if (st.isDirectory()) rec(path.join(cur, name), r);
      else if (st.isFile()) files.push(r);
    }
  };
  rec(dir, '');
  return { files: files.sort(), excludedSecrets };
}

// Deterministic, cross-platform tar+gzip — we DON'T shell out to system `tar` (bsdtar on macOS/Windows
// rejects the GNU --sort/--mtime flags). Emit a plain USTAR archive of the sorted file list (zeroed
// uid/gid/mtime, 0644) then gzip with a zeroed header → same content, same sha256 on any OS. A node
// extracts it with a standard `tar -xzf` (only the GNU CREATE flags were the portability problem).
function ustarHeader(name: string, size: number, mode = 0o644): Buffer {
  const buf = Buffer.alloc(512);
  let nm = name;
  let prefix = '';
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
  buf.write('0000000\0', 108, 8, 'ascii'); // uid 0
  buf.write('0000000\0', 116, 8, 'ascii'); // gid 0
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii'); // size
  buf.write('00000000000\0', 136, 12, 'ascii'); // mtime 0
  buf.write('        ', 148, 8, 'ascii'); // chksum: spaces while summing
  buf.write('0', 156, 1, 'ascii'); // typeflag: regular file
  buf.write('ustar\0', 257, 6, 'ascii'); // magic
  buf.write('00', 263, 2, 'ascii'); // version
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i]!;
  buf.write((sum & 0o777777).toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return buf;
}

function tarGzip(dir: string, files: string[]): Buffer {
  const blocks: Buffer[] = [];
  for (const rel of files) {
    const data = fs.readFileSync(path.join(dir, rel));
    blocks.push(ustarHeader(rel, data.length), data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  const gz = zlib.gzipSync(Buffer.concat(blocks), { level: 9 });
  gz.writeUInt32LE(0, 4); // zero the gzip header MTIME …
  gz[9] = 0xff; // … and the OS byte, so output is identical across machines/OSes
  return gz;
}

export interface PackResult {
  bytes: Buffer;
  sha256: string;
  files: string[]; // included (sorted rel paths)
  excludedSecrets: string[]; // secret-shaped paths deliberately held back
}

// Pack a directory into a deterministic, cross-platform gzipped USTAR tarball — no system `tar`, with
// VCS/deps and secret-shaped files excluded (honoring .gitignore + .circuitignore). The tarball need not
// be byte-identical across packers; its verifier only checks the bytes hash to the signed manifest.sha256.
export function packDir(dir: string): PackResult {
  const { files, excludedSecrets } = listIncluded(dir);
  if (!files.length) throw new Error('nothing to bundle — every file was excluded by ignore rules');
  const bytes = tarGzip(dir, files);
  return { bytes, sha256: sha256hex(bytes), files, excludedSecrets };
}

// Unpack verified bytes into destDir. Caller MUST verify the sha256 first (verifyBundle).
export function unpackTo(bytes: Buffer | Uint8Array, destDir: string): string {
  fs.mkdirSync(destDir, { recursive: true });
  const tmp = path.join(os.tmpdir(), `cbundle-${crypto.randomBytes(6).toString('hex')}.tgz`);
  try {
    fs.writeFileSync(tmp, bytes);
    // refuse path-escaping members; GNU tar strips a leading '/' and we also forbid '..'
    execFileSync('tar', ['--no-same-owner', '-xzf', tmp, '-C', destDir], { stdio: 'pipe' });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return destDir;
}

// An entry must be a plain filename inside the bundle — never a path component that escapes it.
export function isSafeEntry(entry: unknown): entry is string {
  return (
    typeof entry === 'string' &&
    /^[\w][\w.-]*$/.test(entry) &&
    entry !== '.' &&
    entry !== '..' &&
    !entry.includes('/')
  );
}

export interface CreateBundleOptions {
  dir: string;
  agentId: string;
  runtime?: BundleRuntime;
  entry?: string;
  sdk?: string | null;
  egress?: string[];
  resources?: BundleResources | null;
  priv: crypto.KeyObject;
  publisherPubkey: string;
}

export function createBundle({
  dir,
  agentId,
  runtime = 'node',
  entry = 'agent.js',
  sdk = null,
  egress = [],
  resources = null,
  priv,
  publisherPubkey,
}: CreateBundleOptions): { bytes: Buffer; sha256: string; manifest: BundleManifest; files: string[]; excludedSecrets: string[] } {
  if (runtime !== 'node' && runtime !== 'oci') throw new Error(`unknown runtime '${runtime}'`);
  if (!isSafeEntry(entry)) throw new Error(`unsafe entry '${entry}'`);
  if (!fs.existsSync(path.join(dir, entry))) throw new Error(`entry '${entry}' not found in ${dir}`);
  const { bytes, sha256, files, excludedSecrets } = packDir(dir);
  const manifest: BundleManifest = { schema: BUNDLE_SCHEMA, agentId, runtime, entry, sdk, egress, resources, sha256, publisherPubkey };
  manifest.sig = signManifest(manifest, priv);
  return { bytes, sha256, manifest, files, excludedSecrets };
}

// The checks before any code runs: bytes hash to the claimed sha256, the manifest is validly signed,
// (when given) the publisher is the agent's owner and the manifest targets this agent, and the entry is
// a safe in-bundle filename. No unverified bytes ever execute, and a "valid" manifest can't steer
// execution outside the verified tree.
export function verifyBundle(
  bytes: Buffer | Uint8Array,
  manifest: BundleManifest,
  { expectedOwner, expectedAgentId }: { expectedOwner?: string; expectedAgentId?: string } = {},
): VerifyBundleResult {
  if (sha256hex(bytes) !== manifest.sha256) return { ok: false, code: 'sha256-mismatch' };
  if (!verifyManifest(manifest)) return { ok: false, code: 'bad-manifest-sig' };
  if (expectedOwner && manifest.publisherPubkey !== expectedOwner) return { ok: false, code: 'publisher-not-owner' };
  if (expectedAgentId && manifest.agentId !== expectedAgentId) return { ok: false, code: 'agent-id-mismatch' };
  if (!isSafeEntry(manifest.entry)) return { ok: false, code: 'bad-entry' };
  return { ok: true };
}

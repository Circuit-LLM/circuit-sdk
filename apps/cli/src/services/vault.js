// Vault service — owner-side control of a non-custodial Agent Vault (circuit-agent-vault).
//
// Zero-dep on purpose: matches the CLI's anchor-free style (see services/wallet.js). The CLI only ever
// drives OWNER instructions (create / fund / configure / withdraw / close) — never `trade` (that's the
// agent's job, through the on-chain guard). Owner instructions have simple args, so we hand-encode them:
// an Anchor instruction is just `sha256("global:<name>")[0..8]` ++ borsh(args), and the account decode is
// a fixed struct layout. One source of truth for the discriminators (the hash), no vendored IDL to drift.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  PublicKey, SystemProgram, Transaction, Keypair, sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnection, loadKeypair } from './solana.js';
import { config, HOME_DIR, VAULT } from '../config.js';

const VAULTS_DIR = path.join(HOME_DIR, 'vaults');
const VAULT_SEED = Buffer.from('vault');

// ── encoding ────────────────────────────────────────────────────────────────
const disc = (name) => crypto.createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u64le = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64le = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const u32le = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u16le = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const pk = (v) => new PublicKey(v).toBuffer();

const programId = () => new PublicKey(VAULT.programId);

export function vaultPda(owner, agentSeed) {
  return PublicKey.findProgramAddressSync([VAULT_SEED, new PublicKey(owner).toBuffer(), Buffer.from(agentSeed)], programId())[0];
}

// A 32-byte agent seed derived deterministically from the vault name (so a name maps to one vault).
const seedFor = (name) => crypto.createHash('sha256').update(`circuit-vault:${name}`).digest();

// ── meta (delegate key + ids) lives in ~/.circuit/vaults/<name>/ ──────────────
const metaPath = (name) => path.join(VAULTS_DIR, name, 'meta.json');
export const readMeta = (name) => { try { return JSON.parse(fs.readFileSync(metaPath(name), 'utf8')); } catch { return null; } };
export const listVaults = () => { try { return fs.readdirSync(VAULTS_DIR).filter((n) => readMeta(n)); } catch { return []; } };
function writeMeta(name, m) {
  fs.mkdirSync(path.join(VAULTS_DIR, name), { recursive: true, mode: 0o700 });
  fs.writeFileSync(metaPath(name), JSON.stringify(m, null, 2), { mode: 0o600 });
}

// ── tx plumbing ───────────────────────────────────────────────────────────────
function ownerKeypair() {
  const kp = loadKeypair();
  if (!kp) throw new Error('no wallet — set one up first (this wallet is the vault OWNER / withdraw authority)');
  return kp;
}
async function send(rpc, ix, signers) {
  const conn = getConnection(rpc || config.rpcUrl);
  const tx = new Transaction().add(ix);
  return sendAndConfirmTransaction(conn, tx, signers, { commitment: 'confirmed' });
}
const ownerMetas = (vault, owner) => [
  { pubkey: vault, isSigner: false, isWritable: true },
  { pubkey: owner, isSigner: true, isWritable: true },
];
const ix = (keys, data) => ({ programId: programId(), keys, data });

// ── owner operations ──────────────────────────────────────────────────────────

/** Create a vault: generate the agent's trade-only DELEGATE key, derive the seed from the name, and
 *  init the vault on-chain. The CLI wallet becomes the sovereign OWNER (the only withdraw authority). */
export async function create(name, { maxTradeSol = 0.05, maxDailySol = 0.5, rpc } = {}) {
  if (readMeta(name)) throw new Error(`vault "${name}" already exists`);
  const owner = ownerKeypair();
  const agentSeed = seedFor(name);
  const delegate = Keypair.generate();
  const vault = vaultPda(owner.publicKey, agentSeed);
  const maxTrade = Math.round(maxTradeSol * 1e9);
  const maxDaily = Math.round(maxDailySol * 1e9);
  const data = Buffer.concat([disc('init_vault'), agentSeed, delegate.publicKey.toBuffer(), u64le(maxTrade), u64le(maxDaily)]);
  const keys = [
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  const signature = await send(rpc, ix(keys, data), [owner]);
  writeMeta(name, {
    name,
    programId: VAULT.programId,
    owner: owner.publicKey.toBase58(),
    vault: vault.toBase58(),
    agentSeed: agentSeed.toString('hex'),
    delegate: { pubkey: delegate.publicKey.toBase58(), secretKey: bs58.encode(delegate.secretKey) },
    rpc: rpc || config.rpcUrl,
  });
  return { vault: vault.toBase58(), delegate: delegate.publicKey.toBase58(), signature };
}

function metaOrThrow(name) {
  const m = readMeta(name);
  if (!m) throw new Error(`no vault "${name}" — create it:  circuit agent vault create ${name}`);
  return m;
}

/** Fund the vault with native SOL (deposit). Trading cash (wSOL) is wrapped separately by the agent. */
export async function fund(name, sol, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const vault = new PublicKey(m.vault);
  const data = Buffer.concat([disc('deposit'), u64le(Math.round(sol * 1e9))]);
  const keys = [
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: owner.publicKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return send(rpc || m.rpc, ix(keys, data), [owner]);
}

/** OWNER. Withdraw SOL back to the owner — the escape hatch. The delegate has no path here. */
export async function withdraw(name, sol, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const vault = new PublicKey(m.vault);
  const data = Buffer.concat([disc('withdraw'), u64le(Math.round(sol * 1e9))]);
  return send(rpc || m.rpc, ix(ownerMetas(vault, owner.publicKey), data), [owner]);
}

/** OWNER. Pause / unpause trading + update caps (withdraw still works while paused). */
export async function configure(name, { maxTradeSol, maxDailySol, paused, rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const v = await fetch(name, { rpc }); // read current to preserve unspecified fields
  const maxTrade = maxTradeSol != null ? Math.round(maxTradeSol * 1e9) : v.maxTradeLamports;
  const maxDaily = maxDailySol != null ? Math.round(maxDailySol * 1e9) : v.dailyLimitLamports;
  const isPaused = paused != null ? paused : v.paused;
  const data = Buffer.concat([disc('update_config'), u64le(maxTrade), u64le(maxDaily), Buffer.from([isPaused ? 1 : 0])]);
  return send(rpc || m.rpc, ix(ownerMetas(new PublicKey(m.vault), owner.publicKey), data), [owner]);
}

/** OWNER. Rotate the agent's trade-only delegate key (generates + stores a fresh one). */
export async function rotateDelegate(name, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const delegate = Keypair.generate();
  const data = Buffer.concat([disc('set_delegate'), delegate.publicKey.toBuffer()]);
  const signature = await send(rpc || m.rpc, ix(ownerMetas(new PublicKey(m.vault), owner.publicKey), data), [owner]);
  writeMeta(name, { ...m, delegate: { pubkey: delegate.publicKey.toBase58(), secretKey: bs58.encode(delegate.secretKey) } });
  return { delegate: delegate.publicKey.toBase58(), signature };
}

/** OWNER. Restrict trading to an allowlist of router program ids (empty = any program / guard-only). */
export async function setRoutes(name, programs, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  if (programs.length > 4) throw new Error('at most 4 allowed routes');
  const data = Buffer.concat([disc('set_routes'), u32le(programs.length), ...programs.map(pk)]);
  return send(rpc || m.rpc, ix(ownerMetas(new PublicKey(m.vault), owner.publicKey), data), [owner]);
}

/** OWNER. Commit (or clear) the Verified-Intents price rule. op 0 clears it. */
export async function setRule(name, rule, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const { oracle, feed, op, threshold, maxAge, inMint, outMint, maxSlippageBps } = rule;
  const feedBuf = Buffer.from(feed); if (feedBuf.length !== 32) throw new Error('feed must be 32 bytes');
  const z = PublicKey.default.toBuffer();
  const data = Buffer.concat([
    disc('set_rule'), pk(oracle ?? PublicKey.default), feedBuf, Buffer.from([op]),
    i64le(threshold ?? 0), i64le(maxAge ?? 0),
    inMint ? pk(inMint) : z, outMint ? pk(outMint) : z, u16le(maxSlippageBps ?? 0),
  ]);
  return send(rpc || m.rpc, ix(ownerMetas(new PublicKey(m.vault), owner.publicKey), data), [owner]);
}

/** OWNER. Close the vault, returning remaining lamports to the owner. */
export async function close(name, { rpc } = {}) {
  const m = metaOrThrow(name);
  const owner = ownerKeypair();
  const sig = await send(rpc || m.rpc, ix(ownerMetas(new PublicKey(m.vault), owner.publicKey), disc('close_vault')), [owner]);
  fs.rmSync(path.join(VAULTS_DIR, name), { recursive: true, force: true });
  return sig;
}

// ── read state ──────────────────────────────────────────────────────────────
/** Fetch + decode the on-chain Vault account (fixed struct layout after the 8-byte discriminator). */
export async function fetch(name, { rpc } = {}) {
  const m = metaOrThrow(name);
  const conn = getConnection(rpc || m.rpc || config.rpcUrl);
  const info = await conn.getAccountInfo(new PublicKey(m.vault), 'confirmed');
  if (!info) return { exists: false, vault: m.vault, delegate: m.delegate?.pubkey, owner: m.owner };
  const lamports = info.lamports;
  const d = info.data; let o = 8;
  const rdPk = () => { const v = new PublicKey(d.subarray(o, o + 32)).toBase58(); o += 32; return v; };
  const rdU64 = () => { const v = d.readBigUInt64LE(o); o += 8; return v; };
  const rdI64 = () => { const v = d.readBigInt64LE(o); o += 8; return v; };
  const owner = rdPk(); const delegate = rdPk(); o += 32; // skip agent_seed
  const maxTradeLamports = rdU64(); const dailyLimitLamports = rdU64();
  const dayStartTs = rdI64(); const daySpentLamports = rdU64(); const lastTradeTs = rdI64();
  const epoch = rdU64(); const paused = d[o] === 1; o += 1;
  const oracle = rdPk(); o += 32; const ruleOp = d[o]; o += 1; // skip rule_feed
  const ruleThreshold = rdI64(); const ruleMaxAge = rdI64();
  const ruleInMint = rdPk(); const ruleOutMint = rdPk();
  const routes = []; for (let i = 0; i < 4; i++) { const r = rdPk(); if (r !== PublicKey.default.toBase58()) routes.push(r); }
  return {
    exists: true, vault: m.vault, owner, delegate, lamports,
    maxTradeLamports: Number(maxTradeLamports), dailyLimitLamports: Number(dailyLimitLamports),
    daySpentLamports: Number(daySpentLamports), dayStartTs: Number(dayStartTs), lastTradeTs: Number(lastTradeTs),
    epoch: Number(epoch), paused,
    rule: ruleOp ? { oracle, op: ruleOp, threshold: Number(ruleThreshold), maxAge: Number(ruleMaxAge), inMint: ruleInMint, outMint: ruleOutMint } : null,
    routes,
  };
}

// Expose the discriminator + pda helpers for tests/tools.
export const _internal = { disc, vaultPda, seedFor, programId };

// VaultClient — the off-chain SDK the Circuit agent and CLI use to drive a non-custodial vault.
//
// Phase 5. Everything on-chain is already proven (custody, the trade guard, Token-2022, wSOL,
// Verified Intents). This is the thin, honest bridge to it: high-level methods that mirror each
// instruction, plus the one piece that matters for "trade anything" — `trade()`, the SWAP ADAPTER.
//
// The adapter takes ANY swap as a plain `TransactionInstruction` (built by Jupiter, an Orca/Raydium
// router, or a test AMM) and wraps it into a guarded vault `trade`. It does NOT understand the swap;
// it forwards the route and lets the on-chain guard verify the result. The only transform it applies:
// the vault PDA is the swap's authority but cannot sign the outer transaction, so any account equal
// to the vault PDA is flipped to non-signer (the program re-signs it via invoke_signed internally).
// That single rule is what lets a real Jupiter instruction — which marks the user/authority as a
// signer — pass straight through unchanged.
//
// CANONICAL HOME: this mirrors circuit-agent-vault/client/vault-client.ts. The vault repo's client
// should re-export from @circuit/vault to retire the copy (tracked follow-on).
import * as anchor from "@anchor-lang/core";
// NOTE: import BN/Program via the namespace (anchor.BN / anchor.Program), not as named imports —
// @anchor-lang/core is CommonJS and the ESM loader can't resolve all of its named re-exports.
import type { CircuitAgentVault } from "./idl/circuit_agent_vault.ts";

// Value symbols are referenced as anchor.web3.* directly (not destructured) so the generated .d.ts has
// no `const X` colliding with the same-named `type X` alias — tsup's dts bundler rejects that merge.
type PublicKey = anchor.web3.PublicKey;
type Keypair = anchor.web3.Keypair;
type TransactionInstruction = anchor.web3.TransactionInstruction;

/** Classic SPL Token program. */
export const TOKEN_PROGRAM_ID = new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** Token-2022 program. */
export const TOKEN_2022_PROGRAM_ID = new anchor.web3.PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const VAULT_SEED = Buffer.from("vault");
type Numeric = number | bigint | anchor.BN | string;
const toBN = (n: Numeric): anchor.BN => (n instanceof anchor.BN ? n : new anchor.BN(n.toString()));
const seedBuf = (s: Uint8Array | Buffer): Buffer => {
  const b = Buffer.from(s);
  if (b.length !== 32) throw new Error(`agentSeed must be 32 bytes, got ${b.length}`);
  return b;
};

/** Identifies a vault: its sovereign owner + the per-agent seed. */
export interface VaultRef {
  owner: PublicKey;
  agentSeed: Uint8Array | Buffer;
}

export interface InitParams extends VaultRef {
  ownerSigner: Keypair; // pays + becomes the sovereign owner
  delegate: PublicKey; // the agent key (trade-only)
  maxTradeLamports: Numeric;
  dailyLimitLamports: Numeric;
}

export interface TradeParams extends VaultRef {
  delegate: Keypair; // the agent key (signs the trade)
  vaultInput: PublicKey; // vault's input token account (ATA of the vault PDA)
  vaultOutput: PublicKey; // vault's output token account
  amountIn: Numeric;
  minOut: Numeric;
  swapIx: TransactionInstruction; // the DEX swap (Jupiter / Orca / test AMM) — ANY program
  tokenProgram?: PublicKey; // defaults to classic SPL; pass TOKEN_2022_PROGRAM_ID for Token-2022
  oracleIx?: TransactionInstruction; // optional Ed25519 attestation when a Verified-Intents rule is active
  // Address Lookup Tables the swap needs (real Jupiter routes ship these). Required for complex routes —
  // their full account list exceeds the legacy-tx size; the v0 tx compresses them via the ALTs.
  addressLookupTables?: PublicKey[];
  // Extra instructions to land BEFORE the trade (e.g. Jupiter's compute-budget ixs — a real swap needs a
  // raised CU limit). The oracle attestation, if any, is always placed last before the trade instruction.
  preInstructions?: TransactionInstruction[];
}

export class VaultClient {
  readonly program: anchor.Program<CircuitAgentVault>;
  readonly programId: PublicKey;

  constructor(program: anchor.Program<CircuitAgentVault>) {
    this.program = program;
    this.programId = program.programId;
  }

  /** Derive the vault PDA for (owner, agentSeed). No private key exists for it — it's a program address. */
  vaultPda(owner: PublicKey, agentSeed: Uint8Array | Buffer): PublicKey {
    return anchor.web3.PublicKey.findProgramAddressSync([VAULT_SEED, owner.toBuffer(), seedBuf(agentSeed)], this.programId)[0];
  }

  /** Fetch the on-chain vault state (config, delegate, rule, routes). */
  async fetch(ref: VaultRef) {
    return this.program.account.vault.fetch(this.vaultPda(ref.owner, ref.agentSeed));
  }

  // ── owner: lifecycle ─────────────────────────────────────────────────────────────
  /** Create a vault. The signer becomes the owner; `delegate` is the agent that may trade. */
  async initVault(p: InitParams): Promise<{ vault: PublicKey; signature: string }> {
    const vault = this.vaultPda(p.owner, p.agentSeed);
    const signature = await this.program.methods
      .initVault(Array.from(seedBuf(p.agentSeed)), p.delegate, toBN(p.maxTradeLamports), toBN(p.dailyLimitLamports))
      .accountsPartial({ vault, owner: p.owner, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([p.ownerSigner])
      .rpc();
    return { vault, signature };
  }

  /** Fund the vault with SOL. Anyone may deposit; only the owner can take it back out. */
  async deposit(ref: VaultRef, depositor: Keypair, amountLamports: Numeric): Promise<string> {
    return this.program.methods
      .deposit(toBN(amountLamports))
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), depositor: depositor.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([depositor])
      .rpc();
  }

  /** OWNER-ONLY. Move SOL out of the vault to the owner. The only exit; the delegate has no path here. */
  async withdraw(ref: VaultRef, ownerSigner: Keypair, amountLamports: Numeric): Promise<string> {
    return this.program.methods
      .withdraw(toBN(amountLamports))
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  /** OWNER-ONLY. Rotate or revoke the agent's trading key (bumps the fence epoch). */
  async setDelegate(ref: VaultRef, ownerSigner: Keypair, newDelegate: PublicKey): Promise<string> {
    return this.program.methods
      .setDelegate(newDelegate)
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  /** OWNER-ONLY. Update trading policy + the pause kill-switch. Withdraw still works when paused. */
  async updateConfig(
    ref: VaultRef,
    ownerSigner: Keypair,
    cfg: { maxTradeLamports: Numeric; dailyLimitLamports: Numeric; paused: boolean },
  ): Promise<string> {
    return this.program.methods
      .updateConfig(toBN(cfg.maxTradeLamports), toBN(cfg.dailyLimitLamports), cfg.paused)
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  /** OWNER-ONLY. Restrict trading to an allowlist of audited routers (≤4). Empty = any program. */
  async setRoutes(ref: VaultRef, ownerSigner: Keypair, programs: PublicKey[]): Promise<string> {
    return this.program.methods
      .setRoutes(programs)
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  /**
   * OWNER-ONLY. Commit (or clear) the Verified-Intents price rule. With a rule active, every trade
   * must carry a fresh oracle-signed price satisfying the condition (see `oracleAttestation`) AND —
   * if `inMint`/`outMint` are set — match that exact swap direction. `op: 0` clears the rule.
   */
  async setRule(
    ref: VaultRef,
    ownerSigner: Keypair,
    rule: {
      oracle: PublicKey;
      feed: Uint8Array | Buffer; // 32 bytes
      op: number; // 0=off, 1=<, 2=<=, 3=>, 4=>=
      threshold: Numeric;
      maxAge: Numeric; // seconds
      inMint?: PublicKey; // default: unconstrained direction
      outMint?: PublicKey;
      // Execution floor (docs/EXECUTION_FLOOR.md): 0 = off; else `min_out` must be ≥ amount_in × the
      // attested rate × (1 − maxSlippageBps/10000). Required for untrusted hosts to prevent bad-rate trades.
      maxSlippageBps?: number;
    },
  ): Promise<string> {
    return this.program.methods
      .setRule(
        rule.oracle,
        Array.from(seedBuf(rule.feed)),
        rule.op,
        toBN(rule.threshold),
        toBN(rule.maxAge),
        rule.inMint ?? anchor.web3.PublicKey.default,
        rule.outMint ?? anchor.web3.PublicKey.default,
        rule.maxSlippageBps ?? 0,
      )
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  /** OWNER-ONLY. Clear any committed rule (trades resume with no attestation). */
  async clearRule(ref: VaultRef, ownerSigner: Keypair): Promise<string> {
    return this.setRule(ref, ownerSigner, { oracle: anchor.web3.PublicKey.default, feed: Buffer.alloc(32), op: 0, threshold: 0, maxAge: 0, maxSlippageBps: 0 });
  }

  /** OWNER-ONLY. Close the vault and return all remaining lamports to the owner. */
  async closeVault(ref: VaultRef, ownerSigner: Keypair): Promise<string> {
    return this.program.methods
      .closeVault()
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), owner: ref.owner })
      .signers([ownerSigner])
      .rpc();
  }

  // ── wSOL ──────────────────────────────────────────────────────────────────────────
  /** OWNER-or-DELEGATE. Wrap SOL into the vault's wSOL account (funded from `actor`). */
  async wrapSol(ref: VaultRef, actor: Keypair, wsol: PublicKey, amountLamports: Numeric): Promise<string> {
    return this.program.methods
      .wrapSol(toBN(amountLamports))
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), actor: actor.publicKey, wsol, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
      .signers([actor])
      .rpc();
  }

  /** OWNER-or-DELEGATE. Unwrap: close the vault's wSOL account back to native SOL in the vault PDA. */
  async unwrapSol(ref: VaultRef, actor: Keypair, wsol: PublicKey): Promise<string> {
    return this.program.methods
      .unwrapSol()
      .accountsPartial({ vault: this.vaultPda(ref.owner, ref.agentSeed), actor: actor.publicKey, wsol, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([actor])
      .rpc();
  }

  // ── delegate: the trade adapter ─────────────────────────────────────────────────────
  /**
   * DELEGATE-ONLY. Execute a swap through the guarded vault. `swapIx` is the DEX instruction for the
   * route the agent picked (Jupiter, Orca, a test AMM — any program); this wraps it as the vault's
   * guarded CPI and lets the on-chain guard verify the result (input spent ≤ amountIn, output
   * received ≥ minOut, nothing else moved, no authority change). The agent never touches a private key
   * that can withdraw — the worst it can do is a bad-but-bounded trade.
   */
  async trade(p: TradeParams): Promise<string> {
    const vault = this.vaultPda(p.owner, p.agentSeed);
    // Forward the swap's accounts verbatim, except: the vault PDA is the swap authority but can't sign
    // the outer tx (the program re-signs it via invoke_signed). Flip any vault-PDA account to non-signer.
    const remaining = p.swapIx.keys.map((k) => ({
      pubkey: k.pubkey,
      isSigner: k.isSigner && !k.pubkey.equals(vault),
      isWritable: k.isWritable,
    }));
    const tradeIx = await this.program.methods
      .trade(toBN(p.amountIn), toBN(p.minOut), Buffer.from(p.swapIx.data))
      .accountsPartial({
        vault,
        delegate: p.delegate.publicKey,
        vaultInput: p.vaultInput,
        vaultOutput: p.vaultOutput,
        swapProgram: p.swapIx.programId,
        tokenProgram: p.tokenProgram ?? TOKEN_PROGRAM_ID,
        instructions: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
      })
      .remainingAccounts(remaining)
      .instruction();

    // Build a v0 (versioned) transaction so real Jupiter routes fit: their account list exceeds the
    // 1232-byte legacy limit and is compressed via Address Lookup Tables. Simple routes pass no ALTs and
    // this is just a v0 tx with the accounts inline — which is why the existing suite still passes.
    const provider = this.program.provider as anchor.AnchorProvider;
    const conn = provider.connection;
    const luts = (
      await Promise.all((p.addressLookupTables ?? []).map((a) => conn.getAddressLookupTable(a).then((r) => r.value)))
    ).filter((x): x is anchor.web3.AddressLookupTableAccount => x != null);

    const instructions = [
      ...(p.preInstructions ?? []), // e.g. Jupiter's compute-budget ixs (a real swap needs a raised CU limit)
      // The Verified-Intents attestation must be a sibling instruction BEFORE the trade so the runtime
      // verifies the Ed25519 signature and the vault can introspect which (pubkey, message) it covered.
      ...(p.oracleIx ? [p.oracleIx] : []),
      tradeIx,
    ];
    const { blockhash } = await conn.getLatestBlockhash();
    const msg = new anchor.web3.TransactionMessage({ payerKey: provider.wallet.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message(luts);
    return provider.sendAndConfirm(new anchor.web3.VersionedTransaction(msg), [p.delegate]);
  }

  /**
   * Build the Ed25519 attestation instruction a Verified-Intents trade must carry. The oracle signs
   * `feed(32) | price(i64 LE) | ts(i64 LE)`; the runtime verifies the signature and the vault confirms
   * which (pubkey, message) it covered. This is the on-chain half of the verified-intents mechanism.
   */
  static oracleAttestation(oracle: Keypair, feed: Uint8Array | Buffer, price: Numeric, tsUnixSecs: Numeric): TransactionInstruction {
    const msg = Buffer.alloc(48);
    seedBuf(feed).copy(msg, 0);
    msg.writeBigInt64LE(BigInt(price.toString()), 32);
    msg.writeBigInt64LE(BigInt(tsUnixSecs.toString()), 40);
    return anchor.web3.Ed25519Program.createInstructionWithPrivateKey({ privateKey: oracle.secretKey, message: msg });
  }
}

# Packages

The SDK is a TypeScript monorepo of focused, scoped packages, plus a Python consume client. Import the
batteries-included **`@circuit-llm/sdk`** to get everything, or depend on exactly the packages you need.

| Package | One-liner |
|---------|-----------|
| [`@circuit-llm/x402`](#circuitx402) | the payment spine — pay/verify x402 in CIRC (zero deps) |
| [`@circuit-llm/core`](#circuitcore) | http · config · ed25519 identity · owner-auth · types (zero deps) |
| [`@circuit-llm/inference`](#circuitinference) | OpenAI-compatible DLLM client |
| [`@circuit-llm/data`](#circuitdata) | typed Circuit Data API client |
| [`@circuit-llm/wallet`](#circuitwallet) | SOL/CIRC balances, transfers, swaps (multi-RPC failover) |
| [`@circuit-llm/models`](#circuitmodels) | circuitllm.xyz/models gateway — prepaid credits + OpenAI-compatible chat |
| [`@circuit-llm/mcp`](#circuitmcp) | MCP server (runnable) — Circuit data + swarm intel as x402-paid agent tools |
| [`@circuit-llm/agent`](#circuitagent) | the `CircuitAgent` runtime (off-box custody + verified intents) |
| [`@circuit-llm/attest`](#circuitattest) | verified intents — sign/verify evidence, rule DSL, decision gate |
| [`@circuit-llm/node`](#circuitnode) | join/manage a mesh node from code |
| [`@circuit-llm/onchain`](#circuitonchain) | StakePoint stake + CIRC balance + mesh_registry reads (pure RPC) |
| [`@circuit-llm/bundle`](#circuitbundle) | build/sign/verify content-addressed agent bundles (zero deps) |
| [`@circuit-llm/vault`](#circuitvault) | drive the non-custodial on-chain vault (opt-in: Anchor) |
| [`@circuit-llm/sdk`](#circuitsdk) | meta-package — re-exports the consume + agent + contributor packages |
| [`circuit-py`](#circuit-py) | Python consume client (inference + data + x402) |

---

## `@circuit-llm/x402`

The generic micropayment client + server verifier. **Zero runtime dependencies.** Full guide: [x402.md](./x402.md).

```ts
class X402Client {
  constructor(opts?: { wallet?: PaymentWallet; maxSpendRaw?: bigint;
                       onPay?: (q: PaymentQuote) => void | Promise<void>; fetchImpl?: typeof fetch; retryDelayMs?: number });
  request(requestFn: (extraHeaders: Record<string,string>) => Promise<Response>): Promise<{ resp, paymentTx, quote }>;
  fetch(url: string | URL, init?: RequestInit): Promise<Response>;
  json<T>(url: string | URL, init?: RequestInit): Promise<{ data: T; status: number; paymentTx: string|null; quote: PaymentQuote|null }>;
}

interface PaymentWallet { sendCirc(recipient: string, amountRaw: bigint): Promise<string>; readonly address?: string | null; }

// quote helpers
circRawFromUsd(usdPrice: number, circUsd: number): bigint;   // server-matching round-up
formatCirc(raw: bigint): string;
parse402(body: unknown, path?: string): PaymentQuote | null;
class CircPriceOracle { get(): Promise<number|null>; requiredRaw(usdPrice: number): Promise<bigint>; }

// server side
verifyPaymentTx(txSig: string, requiredRaw: bigint, opts: { connection, treasury, replay?, maxAgeMs?, now? }): Promise<{ received, required }>;
circReceived(tx: ParsedTx, treasury: string, mint?: string): bigint;
class MemoryReplayStore implements ReplayStore {}

// errors
class PaymentRequiredError {}  class SpendCapError {}  class X402RequestError {}
```

---

## `@circuit-llm/core`

Shared foundation. **Zero runtime dependencies.** No global singletons or hardcoded paths — everything
is injectable.

```ts
// http
class HttpError {}  getJson<T>(url, opts?): Promise<T>;  postJson<T>(url, data, opts?): Promise<T>;  fetchT(url, opts?, timeout?): Promise<Response>;

// config (mirrors the live ecosystem defaults)
const DEFAULT_CONFIG: CircuitConfig;
defineConfig(overrides?): CircuitConfig;
configFromEnv(env?): CircuitConfigOverrides;
const CIRC_MINT, CIRC_TOKEN_PROGRAM, CIRC_DECIMALS, SOL_MINT;

// identity (ed25519, SPKI/base64 — the public-registry scheme)
interface Identity { nodeId: string; publicKeyB64: string; privateKeyB64: string; }
generateIdentity(): Identity;
signRequest(id: Identity, body?, now?): SignedHeaders;             // X-Node-Id / -Signature / -Timestamp
verifyRequest(fields, body?): boolean;
stableStringify(obj): string;
loadOrCreateIdentity(path): Promise<Identity>;                     // opt-in filesystem helper

// owner-auth — per-owner control-plane request signing (the wallet IS the identity; byte-identical to
// circuit-agent-cloud, golden-vector locked). The CLI signs with it; a server verifies with it.
ownerAuthHeaders(method, path, body, signer: { secretKey; address }, opts?): Record<string,string>;
verifyOwnerRequest({ method, path, body, headers }, opts?): string | null;   // owner pubkey, or throws (401)
ownerAuthMessage({ method, path, body, ts, nonce }): string;   class NonceStore {}

interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; }
```

---

## `@circuit-llm/inference`

OpenAI-compatible client for the decentralized 72B, paid per call.

```ts
class Inference {
  constructor(opts?: { x402?; wallet?; maxSpendRaw?; onPay?; config?; baseUrl?; model?; internalKey?; fetchImpl? });
  chat(params: ChatParams): Promise<{ content; usage; paymentTx; quote; raw }>;
  chatStream(params: ChatParams): AsyncGenerator<string, ChatStreamResult, void>;   // yields token deltas
  listModels(): Promise<string[]>;
}
interface ChatParams { messages: ChatMessage[]; model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number; signal?: AbortSignal; }
```

- `chat` returns the full completion + a payment receipt.
- `chatStream` yields token deltas; the generator's **return value** is `{ content, usage, paymentTx, quote }`.
- Pass `internalKey` to bypass payment on trusted hosts. Speculative/tree-drafting params are forwarded.

---

## `@circuit-llm/data`

Typed client for the Circuit Data API. Free endpoints return 200; paid endpoints answer 402 and the
client pays + retries automatically.

```ts
class Data {
  constructor(opts?: { x402?; wallet?; maxSpendRaw?; onPay?; config?; baseUrl?; internalKey?; fetchImpl? });
  get<T>(path: string, query?): Promise<T>;     // escape hatch — any data-api path

  // free
  quote(); prices(mints); status(); probe(source);
  // token
  tokenPrice(mint); tokenPrices(mints); tokenInfo(mint); tokenOhlcv(mint, opts?);
  tokenHolders(mint); tokenSecurity(mint); tokenTopTraders(mint); tokenTrending(); scan(mint);
  // wallet
  walletAnalytics(wallet); walletPnl(wallet);
  // market / defi / chain
  marketOverview(); marketSentiment(); newTokens();
  defiOverview(); yields(); stakingYields();
  networkStats(); news(); validators(); bridgeActivity(); nftOverview(); topPools();
}
```

---

## `@circuit-llm/wallet`

SOL + CIRC (Token-2022) operations. `Wallet` implements `PaymentWallet`, so it powers x402 payments.

```ts
class Wallet implements PaymentWallet {
  constructor(opts?: { keypair?; address?; config?; connection?; connections?; rpcUrl?; jupiterApiKey?; jupiterBaseUrl?; fetchImpl? });
  solBalance(): Promise<number | null>;
  circBalance(): Promise<number>;
  sendCirc(to: string, amountRaw: bigint): Promise<string>;   // Token-2022 transfer
  sendSol(to: string, sol: number): Promise<string>;
  swapQuote(inMint, outMint, amount, slippageBps?): Promise<unknown>;
  swap(inMint, outMint, amount, slippageBps?): Promise<{ sig; quote }>;   // Jupiter
  signMessage(message: string | Uint8Array): string;          // Ed25519 → base58 (wallet-signature auth)
  signAndSendTransaction(base64Tx: string): Promise<string>;  // sign a server-built tx + broadcast (failover)
  readonly address: string | null; readonly readOnly: boolean;
}
makeWallet(opts?): Wallet;          // loads CIRCUIT_WALLET if no keypair given

// thrown by sendCirc/sendSol when the wallet is underfunded (instead of an opaque chain error)
class InsufficientFundsError extends Error { token: 'CIRC' | 'SOL'; haveRaw: bigint; needRaw: bigint; }

// keypairs
keypairFromSecret(input): Keypair;  loadKeypairFromEnv(env?): Keypair | null;
generateKeypair(): Keypair;  secretKeyBase58(kp): string;  isValidAddress(s): boolean;

// self-custody executor — drives @circuit-llm/agent's LocalKeypairCustody
walletTradeExecutor(wallet): WalletExecutor;   // buy: SOL→token (sizeSol); sell: amount (base units)→SOL; signs locally
```

Reads and sends **fail over** across `[primary, …public fallbacks]` on a rate-limit or per-try timeout;
transactions are signed **once** against a fresh blockhash, so a retry on another RPC re-broadcasts the
same bytes and can never double-spend. On a failed send the wallet reads balances to distinguish a funds
shortfall (→ `InsufficientFundsError`, with the shortfall) from any other error (re-thrown untouched) —
without adding a round-trip to the happy path. On construction it warns **once** if it's on the default
public RPC (which rate-limits); silence with `CIRCUIT_SUPPRESS_RPC_WARNING=1`. Swaps use Jupiter's free
`lite-api` host, which throttles hard — pass `jupiterApiKey` (or set `JUPITER_API_KEY`) to use the keyed
host, or `jupiterBaseUrl` to point elsewhere. Depends on `@solana/web3.js`, `@solana/spl-token`, `bs58` —
the only "heavy" package. Inject `connection`/`connections` (or `fetchImpl`) for tests or a custom RPC.

---

## `@circuit-llm/models`

Client for the **[circuitllm.xyz/models](https://circuitllm.xyz/models)** gateway — a pay-as-you-go,
OpenAI-compatible reseller of OpenRouter, paid in Solana crypto against a prepaid USD ledger. Distinct from
[`@circuit-llm/inference`](#circuitinference): that pays the DLLM mesh per call in CIRC via x402; this debits
a prepaid balance behind a `sk-circuit-` Bearer key.

```ts
class Models {
  constructor(opts?: { wallet?: Wallet; apiKey?; model?; baseUrl?; fetchImpl? });  // apiKey ← CIRCUIT_MODELS_KEY
  // catalog (public)
  catalog(): Promise<ModelInfo[]>;            // full catalog, Circuit markup applied
  listModelIds(): Promise<string[]>;          // OpenAI /v1/models passthrough
  stats(): Promise<Record<string, unknown>>;
  // account + key (wallet-signature gated)
  account(address?): Promise<AccountInfo>;    // balance + key status
  issueKey(): Promise<KeyResult>;             // issue/rotate the sk-circuit- key (signed)
  // buy credits (wallet)
  quote(token, usd): Promise<PurchaseQuote>;
  buy(token, usd, opts?): Promise<BuyResult>; // build → sign+send → poll-verify, one call
  buildPurchase(token, usd); verifyPurchase(sig);            // the low-level steps
  // chat (metered against balance)
  chat(params): Promise<ChatResult>;
  chatStream(params): AsyncGenerator<string, { content; usage }, void>;
  get openaiBaseUrl(): string;                // hand to the OpenAI SDK
}
modelsAuthMessage(wallet, ts): string;        // canonical wallet-sig message
class ModelsError extends Error { status: number; body: unknown; }
```

`token` is `'USDC' | 'SOL' | 'CIRC'`. `buy()` uses `@circuit-llm/wallet`'s `signAndSendTransaction` to sign
the gateway-built transfer and `issueKey()` uses `signMessage` for the auth signature — so a `wallet` is
required for those; chat needs only an `apiKey`. Chat is plain OpenAI-compatible, so you can also skip this
package and point the official OpenAI SDK at `models.openaiBaseUrl` with your key. Non-2xx responses throw
`ModelsError`. Depends on `@circuit-llm/core` + `@circuit-llm/wallet`.

---

## `@circuit-llm/mcp`

A runnable **[MCP](https://modelcontextprotocol.io) server** (not an import-library) that exposes Circuit's
Solana data + agent-swarm intelligence as tools any AI agent can call, **auto-paid per call in CIRC** via
x402. A thin layer over [`@circuit-llm/data`](#circuitdata): free endpoints return data; paid ones are
auto-paid from the configured wallet, bounded per call **and** per process.

```jsonc
// claude_desktop_config.json → "mcpServers"
{ "circuit": { "command": "npx", "args": ["-y", "@circuit-llm/mcp"],
    "env": { "CIRCUIT_WALLET": "<base58 secret funded with CIRC>" } } }   // omit → free tools only
```

Ten tools — free (`circuit_quote`, `token_price`, `live_prices`, `scan`) plus paid, led by **`swarm_feed`**
and **`swarm_consensus`** (live signals from the trading-agent fleet — data no generic price API has).
Configured entirely by env: spend caps (`CIRCUIT_MCP_MAX_SPEND_CIRC` per call, `CIRCUIT_MCP_MAX_TOTAL_CIRC`
per process), `CIRCUIT_TREASURY` to pin the payee. Read-only; no internal-key bypass. Depends on
`@circuit-llm/data` + `@circuit-llm/wallet`. Full reference: **[apps/mcp/README.md](../apps/mcp/README.md)**.

---

## `@circuit-llm/agent`

The agent runtime. You extend `CircuitAgent`; the runtime owns env wiring, custody (paper · self-custody
· off-box signer · non-custodial vault), the heartbeat, logs, and lifecycle. Full guide: [agents.md](./agents.md).

```ts
abstract class CircuitAgent {
  constructor(opts?: AgentOptions);   // opts.rule + opts.acceptedKeys → verified-intent mode
  // override:
  setup(): void|Promise<void>;  abstract tick(): void|Promise<void>;  onDrain(): void|Promise<void>;  checkpoint(): void|Promise<void>;
  // use:
  buy(token, sizeSol, opts?): Promise<IntentResult>;   sell(token, opts?): Promise<IntentResult>;
  verifiedTrade(inputs, evidence): Promise<IntentResult|null>;   // rule-derived, host-can't-forge
  inference(opts?): Inference;   data(opts?): Data;   readConfig<T>(): T;   log(msg): void;
  // lifecycle:
  start(); runTick(); stop(reason?); run();
  readonly ctx: AgentContext;  readonly custody: Custody;
}

// custody — kind: 'offbox-signer' | 'local' | 'local-keypair' | 'vault'; picked by env, all share one policy gate
interface Custody { intent(i); buy(token, sizeSol, opts?); sell(token, opts?); verifiedIntent?(vi); kind; address; paper; }
class SignerCustody implements Custody {}             // off-box signer client (the mesh default)
class MockCustody implements Custody {}                // local paper trading
class LocalKeypairCustody extends ExecutorCustody {}   // self-custody — signs locally via an executor
class VaultCustody extends ExecutorCustody {}          // non-custodial on-chain vault (opt-in)
abstract class ExecutorCustody implements Custody {}   // shared base for local-keypair + vault
interface TradeExecutor { execute(intent, vi?) }       // injected signer/route (VaultTradeExecutor = deprecated alias)
const DEFAULT_POLICY; normalizePolicy(p?);
// AgentOptions.executor: pass walletTradeExecutor(wallet) → LocalKeypairCustody (no signerUrl needed)

// scaffold
scaffold(name): Record<string,string>;  writeScaffold(name, dir): Promise<string[]>;
// + bin:  circuit-agent new <name>
```

---

## `@circuit-llm/attest`

The **verified-intent** keystone — how the off-box signer is sure a trade is genuinely your strategy's,
not the host's. Zero deps beyond `@circuit-llm/core`. Guide: [verified-intents.md](./verified-intents.md).

```ts
// sign / verify (canonical Ed25519 over stableStringify, raw-hex keys)
generateAttestSigner(): AttestSigner;   attestSignerFromSeed(seedHex): AttestSigner;
signPayload(signer, payload): string;   verifyPayload(pubkeyHex, payload, sigHex): boolean;

// evidence — authenticated inputs the signer trusts
signQuote(signer, { path, data, ts, nonce }): SignedQuote;                 // first-party data
signInferenceReceipt(signer, { inputHash, outputHash, verdict, modelFp, ts, nonce }): InferenceReceipt;
type Evidence = SignedQuote | InferenceReceipt | ZkTlsProof;
verifyEvidence(ev, { acceptedKeys, acceptedNotaries?, maxAgeMs?, replay? }): EvidenceResult;

// rule — a committed, re-runnable decision
type Rule = { id; when: Condition[]; then: RuleThen; requires: string[] };
evaluateRule(rule, inputs): Intent | null;          // pure; the SAME fn the signer re-runs
sameIntent(a, b): boolean;   normalizeRule(rule): Rule;

// the gate — verify evidence → bind inputs → re-run rule → must equal the intent
decisionGate({ intent, rule, inputs, evidence }, { rule, acceptedKeys, ... }): GateResult;
//   codes: verified | unknown-rule | evidence-* | input-mismatch | decision-unjustified
```

The producers (`circuit-data-api`, the inference gateway) sign with this scheme; the consumers
(`@circuit-llm/data.getSigned`, `@circuit-llm/inference.chatVerified`) verify with it; the signer enforces
`decisionGate` before signing. A byte-identical plain-JS port runs in `circuit-agent-cloud`.

---

## `@circuit-llm/node`

Join/manage a mesh node. Two clients (and two ed25519 identity schemes — see
[architecture.md](./architecture.md#two-identity-schemes)). Full guide:
[contributing-a-node.md](./contributing-a-node.md).

```ts
// mesh control plane (circuit-dllm) — node_id is the raw ed25519 pubkey hex
class MeshControl {
  constructor(opts: { controlUrl; identity?; nodeId?; fetchImpl?; timeoutMs? });
  register(p: RegisterParams): Promise<RegisterResult>;   // signed
  ready(); heartbeat(); drain(); topology(); health();
}
generateMeshIdentity(): MeshIdentity;  meshIdentityFromSeed(seedHex): MeshIdentity;
signMeshBody(id, body, now?): object;  verifyMeshBody(body): boolean;

// public node registry — signed with the @circuit-llm/core identity (SPKI/base64)
class NodeRegistry {
  constructor(opts: { registryUrl; identity; fetchImpl?; timeoutMs? });
  announce(p); ping(update?); deregister(); getPeers(filters?);
}
```

---

## `@circuit-llm/onchain`

Read-only Solana, via pure JSON-RPC — **no `@solana/web3.js`.**

```ts
getStakePositions(wallet, pool, opts: RpcOptions): Promise<StakePosition[]>;
verifyStake(wallet, pool, minAmount, opts: RpcOptions & { decimals? }): Promise<StakeResult>;   // .eligible, .stakedAmount, …
circBalance(wallet, opts: RpcOptions & { mint? }): Promise<number>;
rpcCall<T>(opts, method, params): Promise<T>;   class RpcError {}
const STAKEPOINT_PROGRAM_ID;

// mesh_registry — the on-chain DLLM control plane (topology + per-node membership/trust/ban)
getMeshConfig(opts: RpcOptions): Promise<MeshConfig | null>;        // authority · auditor · model · slots · version
getNodes(opts: RpcOptions): Promise<MeshNode[]>;   getNode(nodePubkey, opts): Promise<MeshNode | null>;
const MESH_REGISTRY_PROGRAM_ID;
// RpcOptions = { rpcUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }
```

---

## `@circuit-llm/bundle`

Content-addressed, signed **agent bundles** — the canonical codec shared with `circuit-agent-cloud` + the
CLI (byte-identical signing, golden-vector locked). A cross-platform packer (no system `tar`) that
**excludes secret-shaped files** (`.env`, keypairs, `.ssh/`, …) and honors `.gitignore`/`.circuitignore`.
**Zero runtime dependencies.**

```ts
createBundle({ dir, agentId, runtime?, entry?, sdk?, egress?, resources?, priv, publisherPubkey })
  : { bytes; sha256; manifest; files; excludedSecrets };
verifyBundle(bytes, manifest, { expectedOwner?, expectedAgentId? }): { ok; code? };
packDir(dir): { bytes; sha256; files; excludedSecrets };   unpackTo(bytes, destDir): string;
manifestSigningBytes(m): Buffer;  signManifest(m, priv): string;  verifyManifest(m): boolean;  isSafeEntry(e): boolean;
// crypto: fromSeed(seed), sign(priv, msg), verify(pubkey, msg, sig), base58, base58decode, sha256hex
```

---

## `@circuit-llm/vault`

The off-chain client for the non-custodial **circuit-agent-vault** Anchor program — the agent can *trade*
the vault but never *withdraw* (the owner is the sole withdraw authority, enforced on-chain). **Opt-in:**
pulls `@anchor-lang/core`, so install it only when you want on-chain vault custody.

```ts
loadVaultProgram(connection, wallet): Program<CircuitAgentVault>;
class VaultClient {
  vaultPda(owner, agentSeed);  fetch(ref);
  initVault(p); deposit(ref, …); withdraw(ref, …); setDelegate(ref, …); updateConfig(ref, …);
  setRoutes(ref, …); setRule(ref, …); closeVault(ref, …); wrapSol(…); unwrapSol(…);
  trade(p): Promise<string>;                          // the route-agnostic, on-chain-guarded swap adapter
}
makeVaultExecutor(opts): { execute(intent, vi?) };    // the concrete executor for @circuit-llm/agent's VaultCustody
jupiterSwapInstruction(q, vaultAuthority, fetchFn?);  // the production route source (Jupiter)
```

---

## `@circuit-llm/sdk`

The meta-package. `export *` from the consume + agent + contributor packages (collision-free) so you can:

```ts
import { Inference, Data, makeWallet, X402Client, CircuitAgent, MeshControl, verifyStake } from '@circuit-llm/sdk';
```

`@circuit-llm/bundle` and `@circuit-llm/vault` are **not** re-exported here — import them directly. (Bundle is a
publish-time tool; vault pulls Anchor, so the meta stays lean.)

---

## `circuit-py`

The Python consume client — `Inference`, `Data`, `X402Client`. Stdlib-only; bring your own
`PaymentWallet` (`send_circ`).

```python
from circuit import Inference, Data, X402Client, circ_raw_from_usd, parse_402

ai = Inference(wallet=my_wallet)                 # .chat(messages, …), .list_models()
data = Data(wallet=my_wallet)                    # .token_price(mint), .market_overview(), .get(path, query)
x402 = X402Client(wallet=my_wallet, max_spend_raw=500_000_000)
```

Both the HTTP transport and the wallet are injectable. Scope: inference + data + x402. Streaming and a
built-in Solana wallet are TypeScript-only; in Python you bring your own `PaymentWallet`.

# Packages

The SDK is a TypeScript monorepo of focused, scoped packages, plus a Python consume client. Import the
batteries-included **`@circuit/sdk`** to get everything, or depend on exactly the packages you need.

| Package | One-liner |
|---------|-----------|
| [`@circuit/x402`](#circuitx402) | the payment spine — pay/verify x402 in CIRC (zero deps) |
| [`@circuit/core`](#circuitcore) | http · config · ed25519 identity · types (zero deps) |
| [`@circuit/inference`](#circuitinference) | OpenAI-compatible DLLM client |
| [`@circuit/data`](#circuitdata) | typed Circuit Data API client |
| [`@circuit/wallet`](#circuitwallet) | SOL/CIRC balances, transfers, swaps |
| [`@circuit/agent`](#circuitagent) | the `CircuitAgent` runtime (off-box custody) |
| [`@circuit/node`](#circuitnode) | join/manage a mesh node from code |
| [`@circuit/onchain`](#circuitonchain) | StakePoint stake + CIRC balance (pure RPC) |
| [`@circuit/sdk`](#circuitsdk) | meta-package — re-exports all of the above |
| [`circuit-py`](#circuit-py) | Python consume client (inference + data + x402) |

---

## `@circuit/x402`

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

## `@circuit/core`

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

interface ChatMessage { role: 'system'|'user'|'assistant'|'tool'; content: string; }
```

---

## `@circuit/inference`

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

## `@circuit/data`

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

## `@circuit/wallet`

SOL + CIRC (Token-2022) operations. `Wallet` implements `PaymentWallet`, so it powers x402 payments.

```ts
class Wallet implements PaymentWallet {
  constructor(opts?: { keypair?; address?; config?; connection?; rpcUrl? });
  solBalance(): Promise<number | null>;
  circBalance(): Promise<number>;
  sendCirc(to: string, amountRaw: bigint): Promise<string>;   // Token-2022 transfer
  sendSol(to: string, sol: number): Promise<string>;
  swapQuote(inMint, outMint, amount, slippageBps?): Promise<unknown>;
  swap(inMint, outMint, amount, slippageBps?): Promise<{ sig; quote }>;   // Jupiter
  readonly address: string | null; readonly readOnly: boolean;
}
makeWallet(opts?): Wallet;          // loads CIRCUIT_WALLET if no keypair given

// keypairs
keypairFromSecret(input): Keypair;  loadKeypairFromEnv(env?): Keypair | null;
generateKeypair(): Keypair;  secretKeyBase58(kp): string;  isValidAddress(s): boolean;
```

Depends on `@solana/web3.js`, `@solana/spl-token`, `bs58` — the only "heavy" package. Inject a
`connection` for tests or a custom RPC.

---

## `@circuit/agent`

The agent runtime. You extend `CircuitAgent`; the runtime owns env wiring, off-box custody, the
heartbeat, logs, and lifecycle. Full guide: [agents.md](./agents.md).

```ts
abstract class CircuitAgent {
  constructor(opts?: AgentOptions);
  // override:
  setup(): void|Promise<void>;  abstract tick(): void|Promise<void>;  onDrain(): void|Promise<void>;  checkpoint(): void|Promise<void>;
  // use:
  buy(token, sizeSol, opts?): Promise<IntentResult>;   sell(token, opts?): Promise<IntentResult>;
  inference(opts?): Inference;   data(opts?): Data;   readConfig<T>(): T;   log(msg): void;
  // lifecycle:
  start(); runTick(); stop(reason?); run();
  readonly ctx: AgentContext;  readonly custody: Custody;
}

// custody
interface Custody { intent(i); buy(token, sizeSol, opts?); sell(token, opts?); kind; address; paper; }
class SignerCustody implements Custody {}     // the real off-box signer client
class MockCustody implements Custody {}        // local paper trading, same policy semantics
const DEFAULT_POLICY; normalizePolicy(p?);

// scaffold
scaffold(name): Record<string,string>;  writeScaffold(name, dir): Promise<string[]>;
// + bin:  circuit-agent new <name>
```

---

## `@circuit/node`

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

// public node registry — signed with the @circuit/core identity (SPKI/base64)
class NodeRegistry {
  constructor(opts: { registryUrl; identity; fetchImpl?; timeoutMs? });
  announce(p); ping(update?); deregister(); getPeers(filters?);
}
```

---

## `@circuit/onchain`

Read-only Solana, via pure JSON-RPC — **no `@solana/web3.js`.**

```ts
getStakePositions(wallet, pool, opts: RpcOptions): Promise<StakePosition[]>;
verifyStake(wallet, pool, minAmount, opts: RpcOptions & { decimals? }): Promise<StakeResult>;   // .eligible, .stakedAmount, …
circBalance(wallet, opts: RpcOptions & { mint? }): Promise<number>;
rpcCall<T>(opts, method, params): Promise<T>;   class RpcError {}
const STAKEPOINT_PROGRAM_ID;
// RpcOptions = { rpcUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number }
```

---

## `@circuit/sdk`

The meta-package. `export *` from all of the above (collision-free) so you can:

```ts
import { Inference, Data, makeWallet, X402Client, CircuitAgent, MeshControl, verifyStake } from '@circuit/sdk';
```

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

Both the HTTP transport and the wallet are injectable. Scope: inference + data + x402 (streaming and a
built-in Solana wallet are TypeScript-only for now).

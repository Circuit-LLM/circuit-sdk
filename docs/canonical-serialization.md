# Canonical serialization

Ed25519 signatures across the Circuit ecosystem are computed over a **canonical JSON string** (sorted
keys, recursive). For a signature to verify, the signer and every verifier — often in **different
repos** — must produce **byte-identical** bytes.

## The one rule

`@circuit/core` exports a single canonical serializer, **`stableStringify`**, used by everything in the
SDK (`@circuit/attest`, `@circuit/node`, `owner-auth`). It:

- **sorts object keys** recursively, by UTF-16 code unit (JS `Array.sort` default);
- **drops `undefined`** — omits undefined-valued keys, coerces a primitive `undefined` → `null` — so the
  output is **always valid JSON**;
- **keeps strings literal** — no non-ASCII escaping (JS `JSON.stringify` default);
- assumes **integer / simple** numbers in signed payloads.

`undefined` isn't a JSON value; dropping it is the deterministic fallback, not a licence to sign
`undefined`. Producers normalize before signing anyway (see the sweep below).

> If number formatting ever gets non-trivial (floats / exponents), adopt **RFC 8785 / JCS** rather than
> extending this rule by hand.

## Golden vectors (the drift guard)

- **Vectors:** [`packages/core/test/canonical-vectors.json`](../packages/core/test/canonical-vectors.json)
  — fixed `input → canonical` pairs covering key ordering, nesting, arrays, null, numbers, **non-ASCII
  keys/values**, and the `undefined` cases. `undefined` is JSON-unrepresentable, so it's encoded as the
  `undefinedSentinel` string; revive it before calling. Each vector carries an `undefinedInput` flag
  (see the cross-repo note).
- **Test:** [`canonical-serialization.test.ts`](../packages/core/test/canonical-serialization.test.ts)
  asserts `stableStringify` reproduces every vector, that the output is always valid JSON, and that
  non-ASCII stays unescaped. Any drift fails CI.

## Cross-repo status

The **SDK is converged**: one serializer, drops `undefined`. The peers are mid-migration:

| Repo | impl | `undefined` | status |
|---|---|---|---|
| **circuit-sdk** | `@circuit/core` `stableStringify` | **drops** | ✅ converged — attest / node / owner-auth all use the one function |
| circuit-data-api | `lib/attest.js` | keeps | ⏳ converge to drop + import the shared fn |
| circuit-agent-cloud | `verified-intent.js` · `owner-auth.js` · `node-auth.js` | mixed (verified-intent keeps; owner/node drop) | ⏳ converge the keep one |
| circuit-dllm | Python `json.dumps(sort_keys, separators)` | n/a (Python has no `undefined`) | ⏳ set `ensure_ascii=False` + run the vectors |

They interoperate **today** because every real payload is `undefined`-free (proven next), so "keeps" and
"drops" produce identical bytes. The migration removes the ambiguity permanently.

## Producer sweep — the `undefined` invariant HOLDS (by construction)

Checked at every signing call site across all four repos: **no signed payload can contain `undefined`.**
- **verified-intents / attest:** `evidence.ts` `receiptPayload` does `verdict ?? null`; `quotePayload`
  picks required fields; `data`/`claim` are `Record<string, number|string|boolean>`. circuit-data-api
  matches (`verdict == null ? null : verdict`).
- **mesh:** `@circuit/node` adds optional fields conditionally (`if (x) body.y = x`), never `= undefined`;
  circuit-dllm is Python (no `undefined`).
- **owner-auth:** drops `undefined` regardless.

**Consequence:** converging every peer to drop is a **zero-wire-change** migration — no real signed bytes
change (the vectors prove keep and drop agree on every `undefined`-free input).

## Finishing the migration (the peers)

The SDK half — converge to one serializer + the vectors — is **done**. Remaining:

1. **Each Node peer converges + dedups.** Once `@circuit/core` is published, circuit-data-api and
   circuit-agent-cloud `import { stableStringify }` from it and delete their local copies (circuit-cli
   already delegates). **Prerequisite: publish `@circuit/core`** — the same prerequisite as `circuit-agent`
   consuming the SDK; one investment unlocks both.
2. **circuit-dllm** sets `ensure_ascii=False` and adds the conformance test below.
3. Until a peer converges, run only the `undefinedInput === false` subset there (all impls agree on it).

### Mirror test (drop into each peer, no publishing needed)

```js
// copy canonical-vectors.json alongside; `canonicalize` = this repo's stableStringify / json.dumps wrapper
const { undefinedSentinel, vectors } = require('./canonical-vectors.json');
const revive = (v) => v === undefinedSentinel ? undefined
  : (v === null || typeof v !== 'object') ? v
  : Array.isArray(v) ? v.map(revive)
  : Object.fromEntries(Object.keys(v).map((k) => [k, revive(v[k])]));
for (const v of vectors) {
  if (v.undefinedInput && REPO_STILL_KEEPS_UNDEFINED) continue; // remove this line once converged
  assert.equal(canonicalize(revive(v.input)), v.canonical, v.note);
}
```
Python: the same, with `json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.

## Changing the format (deliberately)

1. Update the impl **and** regenerate the vectors in the same PR.
2. Roll it out to **every repo at once** (signer + verifiers switch together) — or add a scheme **version
   tag** and accept both during a transition.
3. Keep the sweep true: any new optional field must be normalized (`?? null` or a conditional add) at the
   producer, so it never reaches the serializer as `undefined`.

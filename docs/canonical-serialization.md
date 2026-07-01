# Canonical serialization

Ed25519 signatures across the Circuit ecosystem are computed over a **canonical JSON string** (sorted
keys, recursive). For a signature to verify, the signer and every verifier must produce **byte-identical**
bytes, so the SDK pins one serializer and one set of golden vectors.

## The one rule

`@circuit-llm/core` exports a single canonical serializer, **`stableStringify`**, used by everything in the
SDK (`@circuit-llm/attest`, `@circuit-llm/node`, and owner-auth). It:

- **sorts object keys** recursively, by UTF-16 code unit (the JS `Array.sort` default);
- **drops `undefined`** — omits undefined-valued keys and coerces a primitive `undefined` → `null` — so
  the output is **always valid JSON**;
- **keeps strings literal** — no non-ASCII escaping (the JS `JSON.stringify` default);
- assumes **integer / simple** numbers in signed payloads.

`undefined` isn't a JSON value; dropping it is the deterministic fallback, not a licence to sign
`undefined`. Normalize your payload before signing (`?? null`, or add optional fields conditionally) so no
field ever reaches the serializer as `undefined`.

> If number formatting ever becomes non-trivial (floats / exponents), adopt **RFC 8785 / JCS** rather than
> extending this rule by hand.

## Golden vectors (the drift guard)

- **Vectors:** [`packages/core/test/canonical-vectors.json`](../packages/core/test/canonical-vectors.json)
  — fixed `input → canonical` pairs covering key ordering, nesting, arrays, null, numbers, **non-ASCII
  keys/values**, and the `undefined` cases. `undefined` is JSON-unrepresentable, so it is encoded as the
  `undefinedSentinel` string; revive it before calling `stableStringify`.
- **Test:** [`canonical-serialization.test.ts`](../packages/core/test/canonical-serialization.test.ts)
  asserts that `stableStringify` reproduces every vector, that the output is always valid JSON, and that
  non-ASCII stays unescaped. Any drift fails CI.

An implementation in another language interoperates by reproducing the same vectors. In Python, for
example, `json.dumps(x, sort_keys=True, separators=(",", ":"), ensure_ascii=False)` matches, given a
payload with no `undefined`/`None`-valued keys.

## Changing the format (deliberately)

1. Update the implementation **and** regenerate the vectors in the same change.
2. Roll it out to every signer and verifier together, or add a scheme **version tag** and accept both
   during a transition.
3. Any new optional field must be normalized (`?? null` or a conditional add) at the producer, so it
   never reaches the serializer as `undefined`.

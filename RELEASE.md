# Releasing

The `@circuit-llm/*` packages publish to npm; `circuit-py` publishes to PyPI separately.

## Before publishing

```bash
npm install
npm run typecheck        # all packages clean
npm test                 # TS suite green
npm run build            # every package produces dist/*.js + .d.ts
```

Bump the version across the workspace (all `@circuit-llm/*` packages share one version, and their
internal dependency pins must match). Commit the bump on a clean tree.

## Publish the TypeScript packages

Publishing order matters: the packages depend on each other with exact version pins, so each must
be published only after everything it depends on. `scripts/publish.sh` encodes that order.

```bash
npm login                        # an account with publish rights on the @circuit-llm scope
scripts/publish.sh --dry-run     # inspect the tarballs — change nothing
scripts/publish.sh               # publish for real  (add --otp <code> if 2FA is on)
```

The order it walks (leaves first, meta last):

1. `core` · `x402` · `bundle` · `vault` — zero internal deps
2. `attest` · `wallet` · `node` · `onchain` — need `core`/`x402`
3. `inference` · `data` — need `core`/`x402`/`attest`
4. `agent` — needs `inference`/`data`/`attest`
5. `sdk` — the batteries-included meta-package, depends on all

Every `npm publish` runs the package's `prepack` (a `tsup` build), so `dist/` is always current.
Each package ships only `dist/`, `README.md`, `LICENSE`, and `package.json` (verified via
`npm publish --dry-run`); scoped packages carry `publishConfig.access: "public"`.

## Publish the Python client

```bash
cd circuit-py
python3 -m build                 # sdist + wheel into dist/
python3 -m twine upload dist/*   # to PyPI
```

# @circuit-llm/bundle

> Build, sign, verify, and unpack **content-addressed (sha256) signed agent bundles** — the canonical codec shared by the Circuit agent cloud and the `circuit` CLI. **Zero runtime dependencies.**

Part of the **[Circuit SDK](https://github.com/Circuit-LLM/circuit-sdk)**. [Packages →](https://github.com/Circuit-LLM/circuit-sdk/blob/main/docs/packages.md)

## Install

```bash
npm install @circuit-llm/bundle
```

## Usage

```ts
import { packDir, createBundle, verifyBundle, unpackTo, fromSeed } from '@circuit-llm/bundle';

const resources = await packDir('./my-agent');                        // read + hash a folder
const bundle = createBundle(resources, { entry: 'index.js' }, fromSeed(seed));   // signed manifest

verifyBundle(bundle);                                                 // checks hashes + signature
await unpackTo(bundle, './out');
```

Every file is content-addressed and the manifest is signed, so a bundle can't be silently altered between author and host. `isSafeEntry` blocks path traversal.

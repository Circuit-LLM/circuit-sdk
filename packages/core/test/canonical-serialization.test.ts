import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stableStringify } from '../src/index.ts';

// Golden-vector conformance for THE canonical serializer (docs/canonical-serialization.md). These bytes
// are the cross-repo signing contract — @circuit/attest + @circuit/node + owner-auth + circuit-data-api +
// circuit-agent-cloud + circuit-dllm all sign/verify over the same canonical JSON. Drift → these fail.
// Mirror this vectors file into the other repos so a change anywhere is caught. Peers still KEEPING
// undefined agree on the `undefinedInput === false` subset until they converge.
const here = dirname(fileURLToPath(import.meta.url));
const { undefinedSentinel, vectors } = JSON.parse(readFileSync(join(here, 'canonical-vectors.json'), 'utf8')) as {
  undefinedSentinel: string;
  vectors: Array<{ note: string; undefinedInput: boolean; input: unknown; canonical: string }>;
};

// JSON can't carry `undefined`, so the vectors encode it as a sentinel string — revive it before use.
function revive(v: unknown): unknown {
  if (v === undefinedSentinel) return undefined;
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(revive);
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(v as object)) o[k] = revive((v as Record<string, unknown>)[k]);
  return o;
}

test('stableStringify reproduces every golden vector byte-for-byte (drift guard)', () => {
  for (const v of vectors) assert.equal(stableStringify(revive(v.input)), v.canonical, v.note);
});

test('the canonical form is ALWAYS valid JSON — undefined is dropped, never emitted', () => {
  for (const v of vectors) {
    const out = stableStringify(revive(v.input));
    assert.doesNotThrow(() => JSON.parse(out), `not valid JSON (${v.note}): ${out}`);
  }
});

test('non-ASCII is kept UNESCAPED (the JS↔Python ensure_ascii contract)', () => {
  const nonAscii = vectors.find((v) => v.note.startsWith('NON-ASCII keys'));
  assert.ok(nonAscii, 'expected a non-ASCII vector');
  assert.match(nonAscii!.canonical, /café/, 'canonical keeps the literal unicode');
  assert.doesNotMatch(nonAscii!.canonical, /\\u00e9/, 'canonical must NOT \\u-escape (Python peers set ensure_ascii=False)');
});

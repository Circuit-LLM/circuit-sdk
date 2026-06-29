#!/usr/bin/env node
import { run } from '../src/index.js';

run().catch((err) => {
  // Keep failures quiet and clean — never dump a raw stack at the user.
  console.error('\n  ' + (err?.message ?? 'unexpected error') + '\n');
  process.exit(1);
});

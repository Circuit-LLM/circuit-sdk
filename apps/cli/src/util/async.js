// Tiny async helpers shared across every layer. No UI, no network — safe for a
// service to import (services must never depend on ui/, per ARCHITECTURE.md).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

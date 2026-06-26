// Batteries-included: re-export the whole SDK from one entry point.
//   import { Inference, Data, makeWallet, X402Client } from '@circuit/sdk';

export * from '@circuit/core';
export * from '@circuit/inference';
export * from '@circuit/data';
export * from '@circuit/wallet';
export * from '@circuit/agent';
export * from '@circuit/node';
export * from '@circuit/onchain';

// @circuit/attest — selective re-export (Intent comes from @circuit/agent;
// ReplayStore/MemoryReplayStore from @circuit/x402 — avoid ambiguous star-exports).
export {
  generateAttestSigner,
  attestSignerFromSeed,
  signPayload,
  verifyPayload,
  signQuote,
  signInferenceReceipt,
  verifyEvidence,
  evidenceBacks,
  evaluateRule,
  sameIntent,
  normalizeRule,
  decisionGate,
} from '@circuit/attest';
export type {
  AttestSigner,
  SignedQuote,
  InferenceReceipt,
  ZkTlsProof,
  Evidence,
  VerifyEvidenceOpts,
  EvidenceResult,
  Condition,
  RuleThen,
  Rule,
  RuleInputs,
  VerifiedIntent,
  GateOptions,
  GateResult,
} from '@circuit/attest';

// @circuit/x402 — re-export everything EXCEPT the CIRC_* constants, which already
// come from @circuit/core (same values; avoids an ambiguous star-export).
export {
  X402Client,
  PaymentRequiredError,
  SpendCapError,
  X402RequestError,
  CircPriceOracle,
  MemoryReplayStore,
  circRawFromUsd,
  formatCirc,
  parse402,
  verifyPaymentTx,
  circReceived,
  MAX_TX_AGE_MS,
  JUPITER_PRICE_URL,
  FALLBACK_CIRC_USD,
} from '@circuit/x402';
export type {
  PaymentWallet,
  PaymentQuote,
  X402Options,
  X402Result,
  X402JsonResult,
  OracleOptions,
  TokenBalance,
  ParsedTx,
  ParsedTxConnection,
  ReplayStore,
  VerifyOptions,
  VerifyResult,
} from '@circuit/x402';

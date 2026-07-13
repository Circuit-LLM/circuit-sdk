// Batteries-included: re-export the whole SDK from one entry point.
//   import { Inference, Data, makeWallet, X402Client } from '@circuit-llm/sdk';

export * from '@circuit-llm/core';
export * from '@circuit-llm/inference';
export * from '@circuit-llm/data';
export * from '@circuit-llm/wallet';

// @circuit-llm/models — selective re-export: Usage/ChatParams/ChatResult are also exported by
// @circuit-llm/inference (a separate, x402-paid service). Import those three from '@circuit-llm/models'
// directly if you need the gateway-specific shapes; everything else comes through here.
export { Models, ModelsError, modelsAuthMessage } from '@circuit-llm/models';
export type {
  CreditToken,
  ModelInfo,
  Catalog,
  AccountInfo,
  PurchaseQuote,
  BuiltPurchase,
  KeyResult,
  PurchaseVerifyResult,
  BuyResult,
  ModelsOptions,
  BuyOptions,
} from '@circuit-llm/models';
export * from '@circuit-llm/agent';
export * from '@circuit-llm/node';
export * from '@circuit-llm/onchain';

// @circuit-llm/attest — selective re-export (Intent comes from @circuit-llm/agent;
// ReplayStore/MemoryReplayStore from @circuit-llm/x402 — avoid ambiguous star-exports).
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
} from '@circuit-llm/attest';
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
} from '@circuit-llm/attest';

// @circuit-llm/x402 — re-export everything EXCEPT the CIRC_* constants, which already
// come from @circuit-llm/core (same values; avoids an ambiguous star-export).
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
} from '@circuit-llm/x402';
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
} from '@circuit-llm/x402';

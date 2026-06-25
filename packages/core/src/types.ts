// Shared types re-exported across the SDK.
// (The payment-wallet interface lives in @circuit/x402 — the spine that consumes it.)

/** OpenAI-style chat message. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

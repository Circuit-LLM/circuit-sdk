// The x402 micropayment flow, shared by inference and the data gateway.
// requestFn(extraHeaders) -> Promise<Response>. On 402, parse the payment
// requirements, pay CIRC from the wallet, and retry with X-Payment-Signature.
import { sleep } from '../util/async.js';

export class PaymentRequiredError extends Error {
  constructor(payment) {
    super(`Payment required: ${payment?.amountDisplay ?? payment?.amountRaw ?? '?'} CIRC`);
    this.name = 'PaymentRequiredError';
    this.payment = payment;
  }
}

export async function withX402(requestFn, wallet, { onPay } = {}) {
  let resp = await requestFn({});
  if (resp.ok || resp.status !== 402) return { resp, paymentTx: null, payment: null };

  const info = await resp.clone().json().catch(() => ({}));
  const pay = info.payment;
  if (!pay?.recipient || !pay?.amountRaw) {
    throw new Error('Endpoint returned 402 without payment requirements');
  }
  if (!wallet?.keypair) throw new PaymentRequiredError(pay);

  onPay?.(pay);
  const txSig = await wallet.sendCirc(pay.recipient, BigInt(pay.amountRaw));

  resp = await requestFn({ 'X-Payment-Signature': txSig });
  // One free retry on transient server errors — the CIRC was already spent.
  if (!resp.ok && [429, 500, 502, 503, 504].includes(resp.status)) {
    await sleep(2000);
    resp = await requestFn({ 'X-Payment-Signature': txSig });
  }
  return { resp, paymentTx: txSig, payment: pay };
}

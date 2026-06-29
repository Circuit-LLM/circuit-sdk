// Minimal base58 ENCODE for rendering 32-byte account fields (pubkeys) as Solana addresses.
// Encode-only and dependency-free — this package deliberately avoids @solana/web3.js. The RPC layer
// already hands us account addresses as base58; this is only for pubkey FIELDS inside account data.

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(buf: Uint8Array | Buffer): string {
  const bytes = Uint8Array.from(buf);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '1'.repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k--) out += B58[digits[k]!]!;
  return out;
}

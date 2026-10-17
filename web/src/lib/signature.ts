/** Exact EIP-191 message the recipient signs, per shared/api-contract.md "Creator signature". */
export function requestSigningMessage(input: {
  id: string;
  recipient: string;
  uniqueAtomic: string;
  expiresAt: string;
}): string {
  return [
    "Tab payment request",
    `id: ${input.id}`,
    `recipient: ${input.recipient}`,
    `amount: ${input.uniqueAtomic} USDC base units on Base`,
    `expires: ${input.expiresAt}`,
  ].join("\n");
}

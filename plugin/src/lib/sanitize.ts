// Memos and labels are untrusted text that ends up in agent context and on web pages. Strip anything that can
// hide or reorder text (control chars, bidi overrides, zero-width), collapse whitespace, then bound the length.
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

export function sanitizeText(value: string | undefined | null, maxLength: number): string | undefined {
  if (value == null) return undefined;
  const cleaned = value.replace(HIDDEN, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return Array.from(cleaned).slice(0, maxLength).join("");
}

/** Quotes untrusted text for tool output so agents read it as data, not instructions. */
export function quoteUntrusted(value: string): string {
  return JSON.stringify(value);
}

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 22;
export const ID_RE = /^[0-9A-Za-z]{22}$/;

/** 22-char base62 id carrying 128 bits of CSPRNG entropy (62^22 > 2^128). */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(ID_LENGTH, "0");
}

export function isId(value: string): boolean {
  return ID_RE.test(value);
}

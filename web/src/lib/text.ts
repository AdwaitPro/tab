// Strips C0/C1 control characters and bidi overrides that could be used to visually spoof text.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function cleanText(value: string): string {
  return value.replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}

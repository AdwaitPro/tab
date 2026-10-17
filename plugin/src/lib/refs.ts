import { ToolError } from "./errors.js";
import { PAYLOAD_PREFIX } from "./payload.js";

export type Ref =
  | { kind: "request"; id: string }
  | { kind: "payload"; id: string }
  | { kind: "split"; id: string }
  | { kind: "request_or_split"; id: string }
  | { kind: "deal"; id: bigint }
  | { kind: "bet"; id: bigint };

const BASE62_ID = /^[0-9A-Za-z]{22}$/;
const PAYLOAD_ID = /^p\.[A-Za-z0-9_-]{16,2000}$/;
const OBJECT_ID = /^[1-9][0-9]{0,30}$/;

function objectId(raw: string, label: string): bigint {
  if (!OBJECT_ID.test(raw)) throw new ToolError(`${label} id must be a positive integer.`);
  return BigInt(raw);
}

/**
 * Accepts Tab links (any host: data is always re-read from the configured Tab API and the chain, never from the
 * link's host), bare ids, `p.<payload>`, and `request:`/`split:`/`deal:`/`bet:` prefixes.
 */
export function parseRef(input: string): Ref {
  const value = input.trim();
  const prefixed = /^(request|split|deal|bet):\s*(.+)$/i.exec(value);
  if (prefixed) {
    const kind = (prefixed[1] ?? "").toLowerCase();
    const id = (prefixed[2] ?? "").trim();
    if (kind === "deal") return { kind: "deal", id: objectId(id, "Deal") };
    if (kind === "bet") return { kind: "bet", id: objectId(id, "Bet") };
    if (kind === "split") {
      if (!BASE62_ID.test(id)) throw new ToolError("Split id must be 22 letters/digits.");
      return { kind: "split", id };
    }
    return requestId(id);
  }
  const path = /(?:^|\/)(r|s|d|b)\/([A-Za-z0-9._-]+)\/?(?:[?#].*)?$/.exec(value);
  if (path) {
    const segment = path[1];
    const id = path[2] ?? "";
    if (segment === "d") return { kind: "deal", id: objectId(id, "Deal") };
    if (segment === "b") return { kind: "bet", id: objectId(id, "Bet") };
    if (segment === "s") {
      if (!BASE62_ID.test(id)) throw new ToolError("Split link id must be 22 letters/digits.");
      return { kind: "split", id };
    }
    return requestId(id);
  }
  if (value.startsWith(PAYLOAD_PREFIX)) return requestId(value);
  if (BASE62_ID.test(value)) return { kind: "request_or_split", id: value };
  throw new ToolError("Unrecognized Tab reference.", "Pass a Tab link (…/r/<id>, /s/<id>, /d/<id>, /b/<id>), a request or split id, or deal:<n> / bet:<n>.");
}

function requestId(id: string): Ref {
  if (PAYLOAD_ID.test(id)) return { kind: "payload", id };
  if (BASE62_ID.test(id)) return { kind: "request", id };
  throw new ToolError("Request id must be 22 letters/digits or an offline p.… payload.");
}

export function requestUrl(base: string, id: string): string {
  return `${base}/r/${id}`;
}
export function splitUrl(base: string, id: string): string {
  return `${base}/s/${id}`;
}
export function dealUrl(base: string, id: bigint): string {
  return `${base}/d/${id.toString()}`;
}
export function betUrl(base: string, id: bigint): string {
  return `${base}/b/${id.toString()}`;
}

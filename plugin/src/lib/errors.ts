/** A domain failure the agent can act on. Rendered as an `isError` result with the remedy appended. */
export class ToolError extends Error {
  readonly remedy: string | undefined;

  constructor(message: string, remedy?: string) {
    super(message);
    this.name = "ToolError";
    this.remedy = remedy;
  }
}

export type NetFailureKind = "timeout" | "network" | "http" | "parse" | "budget";

/** Transport-level failure (timeout, DNS, 5xx, non-JSON). Distinct from domain errors so callers can degrade. */
export class NetError extends Error {
  readonly kind: NetFailureKind;
  readonly status: number | undefined;
  readonly host: string;
  readonly body: unknown;

  constructor(kind: NetFailureKind, host: string, message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "NetError";
    this.kind = kind;
    this.host = host;
    this.status = status;
    this.body = body;
  }

  /** True when another host (or degraded mode) may succeed: timeouts, network errors, 5xx, 429, non-JSON. */
  get retryable(): boolean {
    if (this.kind !== "http") return this.kind !== "budget";
    return this.status === undefined || this.status >= 500 || this.status === 429;
  }
}

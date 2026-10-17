import { TIMEOUTS } from "./constants.js";
import { NetError } from "./errors.js";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Wall-clock budget for one tool call. PayBox kills operations at 10 s; we stay under 8 s of network time. */
export class Budget {
  private readonly deadline: number;

  constructor(totalMs: number = TIMEOUTS.toolBudgetMs, private readonly clock: () => number = Date.now) {
    this.deadline = clock() + totalMs;
  }

  remaining(): number {
    return Math.max(0, this.deadline - this.clock());
  }

  /** Per-attempt timeout: at most 4 s and never past the tool deadline. */
  attemptMs(): number {
    return Math.min(TIMEOUTS.perRequestMs, this.remaining());
  }
}

export interface JsonResponse {
  readonly status: number;
  readonly json: unknown;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

/**
 * One HTTPS JSON request with a bounded timeout. Non-2xx responses resolve when they carry JSON (so callers can
 * read API error bodies) and reject with `NetError` otherwise. Never sets auth headers: PayBox injects them.
 */
export async function fetchJson(fetchFn: FetchFn, budget: Budget, url: string, init: RequestInit = {}): Promise<JsonResponse> {
  const host = hostOf(url);
  const timeout = budget.attemptMs();
  if (timeout < TIMEOUTS.minAttemptMs) throw new NetError("budget", host, `Time budget exhausted before calling ${host}.`);
  let response: Response;
  try {
    response = await fetchFn(url, {
      ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers },
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new NetError("timeout", host, `${host} timed out after ${timeout} ms.`);
    throw new NetError("network", host, `${host} is unreachable.`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new NetError("network", host, `${host} closed the connection.`, response.status);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // Captive portals and bot challenges return HTML; treat as an outage rather than data.
    throw new NetError("parse", host, `${host} returned a non-JSON response (HTTP ${response.status}).`, response.status);
  }
  if (!response.ok && (response.status >= 500 || response.status === 429)) {
    throw new NetError("http", host, `${host} returned HTTP ${response.status}.`, response.status, json);
  }
  return { status: response.status, json };
}

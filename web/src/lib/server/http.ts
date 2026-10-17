import "server-only";
import type { z } from "zod";
import { isAuthorizedBearer } from "./auth";
import { ApiError } from "./errors";
import { clientIp, limiter, type RateLimitPolicy } from "./rate-limit";

const MAX_BODY_BYTES = 32 * 1024;

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function errorResponse(error: ApiError, extraHeaders: HeadersInit = {}): Response {
  return json({ error: { code: error.code, message: error.message } }, error.status, extraHeaders);
}

/** Wraps a route handler: uniform error envelope, one structured log line per request, no stack leaks. */
export function route<Ctx>(
  name: string,
  handler: (request: Request, ctx: Ctx) => Promise<Response>,
): (request: Request, ctx: Ctx) => Promise<Response> {
  return async (request, ctx) => {
    const started = Date.now();
    let response: Response;
    try {
      response = await handler(request, ctx);
    } catch (error) {
      if (error instanceof RateLimitedError) {
        response = errorResponse(error, { "retry-after": String(error.retryAfterSeconds) });
      } else if (error instanceof ApiError) {
        response = errorResponse(error);
      } else {
        console.error(JSON.stringify({ route: name, error: error instanceof Error ? error.message : "unknown" }));
        response = errorResponse(new ApiError("internal", "Internal error"));
      }
    }
    console.info(JSON.stringify({ route: name, method: request.method, status: response.status, ms: Date.now() - started }));
    return response;
  };
}

class RateLimitedError extends ApiError {
  constructor(readonly retryAfterSeconds: number) {
    super("rate_limited", "Too many requests; slow down");
  }
}

export function enforceRateLimit(request: Request, policy: RateLimitPolicy, key = clientIp(request.headers)): void {
  const result = limiter.take(policy, key);
  if (!result.allowed) throw new RateLimitedError(result.retryAfterSeconds);
}

export function requirePluginKey(request: Request): void {
  if (!isAuthorizedBearer(request.headers.get("authorization"), process.env.TAB_PLUGIN_KEY?.trim())) {
    throw new ApiError("unauthorized", "Missing or invalid bearer token");
  }
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new ApiError("invalid_input", "Content-Type must be application/json");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError("invalid_input", "Body too large");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_input", "Body is not valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new ApiError("invalid_input", `${where}${issue?.message ?? "Invalid input"}`);
  }
  return parsed.data;
}

export function parseParam<S extends z.ZodType>(value: unknown, schema: S, what: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError("invalid_input", `Invalid ${what}`);
  return parsed.data;
}

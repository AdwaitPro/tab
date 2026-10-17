export type ApiErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

const STATUS: Record<ApiErrorCode, number> = {
  invalid_input: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number = STATUS[code],
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Postgres unique_violation, unwrapping drizzle's query error wrapper. */
export function isUniqueViolation(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 4; depth++) {
    if (typeof e === "object" && "code" in e && (e as { code: unknown }).code === "23505") return true;
    e = typeof e === "object" && "cause" in e ? (e as { cause: unknown }).cause : undefined;
  }
  return false;
}

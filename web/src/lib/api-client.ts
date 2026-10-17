import { z } from "zod";

const statusSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "paid", "expired", "paid_late", "checking"]),
  paid_tx: z.string().nullable(),
  paid_at: z.string().nullable(),
  payer_address: z.string().nullable(),
  checked_at: z.string(),
});
export type ClientStatus = z.infer<typeof statusSchema>;

export class ApiFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function getJson<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  const res = await fetch(path, { signal, headers: { accept: "application/json" }, cache: "no-store" });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiFetchError("Unexpected response from Tab", res.status);
  }
  if (!res.ok) {
    const message = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    throw new ApiFetchError(message.success ? message.data.error.message : `Request failed (${res.status})`, res.status);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ApiFetchError("Unexpected response shape from Tab", res.status);
  return parsed.data;
}

export function fetchStatus(id: string, signal?: AbortSignal): Promise<ClientStatus> {
  return getJson(`/api/requests/${encodeURIComponent(id)}/status`, statusSchema, signal);
}

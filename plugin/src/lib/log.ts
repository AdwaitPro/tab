// stdout is reserved for MCP frames, and stderr is capped at 16 KiB per operation: one short line per event,
// never payloads, addresses' private data or secrets.
export function log(tool: string, phase: string, fields: Readonly<Record<string, string | number | boolean>> = {}): void {
  if (process.env.TAB_LOG === "off") return;
  try {
    process.stderr.write(`${JSON.stringify({ tool, phase, ...fields })}\n`);
  } catch {
    // Logging must never break a tool call.
  }
}

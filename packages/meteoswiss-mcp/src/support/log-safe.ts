/**
 * Sanitize a value for a single-line stderr log entry: truncate and JSON-stringify so
 * embedded newlines / control characters cannot forge additional log lines (e.g. fake
 * `[MCP Server Error]` entries) — SEC-10.
 *
 * @param value - The raw user input to log
 * @param maxLength - Maximum characters to retain before truncation
 * @returns A quoted, escaped, length-bounded representation safe to interpolate
 */
export function logSafe(value: unknown, maxLength = 200): string {
  const str = typeof value === 'string' ? value : String(value);
  const truncated = str.length > maxLength ? `${str.slice(0, maxLength)}…` : str;
  return JSON.stringify(truncated);
}

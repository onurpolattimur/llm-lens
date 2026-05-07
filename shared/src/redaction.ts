const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "cookie",
  "set-cookie"
]);

export function redactHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const printable = Array.isArray(value) ? value.join(", ") : value ?? "";
      return [key, SENSITIVE_HEADERS.has(key.toLowerCase()) ? maskSecret(printable) : printable];
    })
  );
}

export function maskSecret(value: string): string {
  if (!value) return "";
  const token = value.replace(/^Bearer\s+/i, "");
  if (token.length <= 8) return "[redacted]";
  return `${value.startsWith("Bearer ") ? "Bearer " : ""}${token.slice(0, 6)}...${token.slice(-4)}`;
}


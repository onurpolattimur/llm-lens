import type { CapturedRequest } from "@llm-lens/shared";
import type { InspectorSessionExport } from "./event-store.js";

const PROVIDERS = new Set(["anthropic", "openai", "openrouter", "google", "unknown"]);

export function parseSessionExport(value: unknown): InspectorSessionExport | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.requests)) return undefined;
  const requests = value.requests.filter(isCapturedRequest);
  if (requests.length !== value.requests.length) return undefined;
  return {
    schemaVersion: 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    requests
  };
}

function isCapturedRequest(value: unknown): value is CapturedRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.provider === "string" &&
    PROVIDERS.has(value.provider) &&
    typeof value.method === "string" &&
    typeof value.url === "string" &&
    typeof value.host === "string" &&
    typeof value.path === "string" &&
    isStringRecord(value.requestHeaders)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

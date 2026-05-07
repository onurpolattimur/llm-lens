export type Provider = "anthropic" | "openai" | "openrouter" | "google" | "unknown";

export type NormalizedMessage = {
  id: string;
  role: "system" | "user" | "assistant" | "tool" | "unknown";
  content: string;
  name?: string;
};

export type NormalizedToolCall = {
  id: string;
  name: string;
  input?: unknown;
  inputText?: string;
};

export type NormalizedReasoning = {
  id: string;
  content: string;
  details?: unknown;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
};

export type LlmTrace = {
  requestId: string;
  provider: Provider;
  model?: string;
  inputMessages?: NormalizedMessage[];
  outputMessages?: NormalizedMessage[];
  toolCalls?: NormalizedToolCall[];
  reasoning?: NormalizedReasoning[];
  usage?: TokenUsage;
};

export type StreamChunk = {
  id: string;
  requestId: string;
  timestamp: string;
  raw: string;
  parsed?: unknown;
};

export type CapturedRequest = {
  id: string;
  startedAt: string;
  completedAt?: string;
  provider: Provider;
  method: string;
  url: string;
  host: string;
  path: string;
  statusCode?: number;
  durationMs?: number;
  streaming?: boolean;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  streamChunks?: StreamChunk[];
  trace?: LlmTrace;
  error?: string;
};

export type InspectorSessionExport = {
  schemaVersion: 1;
  exportedAt: string;
  requests: CapturedRequest[];
};

export type InspectorEvent =
  | { type: "snapshot"; requests: CapturedRequest[] }
  | { type: "request:start"; request: CapturedRequest }
  | { type: "request:update"; request: CapturedRequest }
  | { type: "stream:chunk"; requestId: string; chunk: StreamChunk }
  | { type: "request:delete"; requestId: string }
  | { type: "requests:clear" };

export const LLM_PROVIDER_HOSTS = [
  "api.anthropic.com",
  "api.openai.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com"
] as const;

export function detectProvider(host: string): Provider {
  const normalized = normalizeHost(host);
  if (normalized.endsWith("api.anthropic.com")) return "anthropic";
  if (normalized.endsWith("api.openai.com")) return "openai";
  if (normalized.endsWith("openrouter.ai")) return "openrouter";
  if (normalized.endsWith("generativelanguage.googleapis.com")) return "google";
  return "unknown";
}

export function isAllowedProviderHost(host: string): boolean {
  return isAllowedLlmHost(host);
}

export function isAllowedLlmHost(host: string, additionalHosts: string[] = []): boolean {
  const normalized = normalizeHost(host);
  const allowedHosts = [...LLM_PROVIDER_HOSTS, ...additionalHosts.map(normalizeHost)];
  return allowedHosts.some((allowedHost) => normalized === allowedHost);
}

export function parseProviderHosts(value: string | undefined): string[] {
  if (!value) return [];
  const hosts = value
    .split(/[\s,]+/)
    .map((item) => normalizeProviderHostInput(item))
    .filter((item): item is string => Boolean(item));
  return [...new Set(hosts)];
}

function normalizeProviderHostInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return normalizeHost(new URL(trimmed).host);
  } catch {
    return normalizeHost(trimmed.split("/")[0] ?? trimmed);
  }
}

export function normalizeHost(host: string): string {
  return host.toLowerCase().split(":")[0] ?? host.toLowerCase();
}

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

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type LlmTrace = {
  requestId: string;
  provider: Provider;
  model?: string;
  inputMessages?: NormalizedMessage[];
  outputMessages?: NormalizedMessage[];
  toolCalls?: NormalizedToolCall[];
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

export type InspectorEvent =
  | { type: "snapshot"; requests: CapturedRequest[] }
  | { type: "request:start"; request: CapturedRequest }
  | { type: "request:update"; request: CapturedRequest }
  | { type: "stream:chunk"; requestId: string; chunk: StreamChunk };

export const LLM_PROVIDER_HOSTS = [
  "api.anthropic.com",
  "api.openai.com",
  "openrouter.ai",
  "generativelanguage.googleapis.com"
] as const;

export function detectProvider(host: string): Provider {
  const normalized = host.toLowerCase();
  if (normalized.endsWith("api.anthropic.com")) return "anthropic";
  if (normalized.endsWith("api.openai.com")) return "openai";
  if (normalized.endsWith("openrouter.ai")) return "openrouter";
  if (normalized.endsWith("generativelanguage.googleapis.com")) return "google";
  return "unknown";
}

export function isAllowedProviderHost(host: string): boolean {
  const normalized = host.toLowerCase().split(":")[0] ?? host.toLowerCase();
  return LLM_PROVIDER_HOSTS.some((allowedHost) => normalized === allowedHost);
}

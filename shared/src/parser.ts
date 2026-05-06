import type {
  CapturedRequest,
  LlmTrace,
  NormalizedMessage,
  NormalizedToolCall,
  Provider,
  StreamChunk,
  TokenUsage
} from "./index.js";

export function parseJsonBody(raw: Buffer | string | undefined): unknown {
  if (!raw) return undefined;
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function parseSseChunks(requestId: string, text: string, now = new Date()): StreamChunk[] {
  const chunks: StreamChunk[] = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());

    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    if (raw === "[DONE]") {
      chunks.push({ id: cryptoId(), requestId, timestamp: now.toISOString(), raw });
      continue;
    }

    chunks.push({
      id: cryptoId(),
      requestId,
      timestamp: now.toISOString(),
      raw,
      parsed: parseJsonBody(raw)
    });
  }
  return chunks;
}

export function normalizeTrace(request: CapturedRequest): LlmTrace {
  const provider = request.provider;
  const body = isRecord(request.requestBody) ? request.requestBody : {};
  const response = isRecord(request.responseBody) ? request.responseBody : {};

  if (provider === "anthropic") return normalizeAnthropic(request.id, body, response, request.streamChunks ?? []);
  if (provider === "openai") return normalizeOpenAi(request.id, body, response, request.streamChunks ?? []);
  if (provider === "openrouter") return normalizeOpenAi(request.id, body, response, request.streamChunks ?? [], "openrouter");
  if (provider === "google") return normalizeGoogle(request.id, body, response);

  return {
    requestId: request.id,
    provider,
    model: stringValue(body.model),
    inputMessages: normalizeMessageArray(body.messages)
  };
}

function normalizeAnthropic(
  requestId: string,
  body: Record<string, unknown>,
  response: Record<string, unknown>,
  chunks: StreamChunk[]
): LlmTrace {
  const outputMessages = normalizeAnthropicContent(response.content);
  const toolCalls = extractAnthropicToolCalls(response.content);
  const usage = normalizeAnthropicUsage(response.usage);

  const streamedToolCalls = new Map<number, NormalizedToolCall & { inputText?: string }>();
  for (const chunk of chunks) {
    if (!isRecord(chunk.parsed)) continue;
    if (chunk.parsed.type === "content_block_start" && isRecord(chunk.parsed.content_block)) {
      const block = chunk.parsed.content_block;
      if (block.type === "tool_use") {
        streamedToolCalls.set(numberValue(chunk.parsed.index) ?? streamedToolCalls.size, {
          id: stringValue(block.id) ?? cryptoId(),
          name: stringValue(block.name) ?? "tool",
          input: block.input,
          inputText: stringifyMaybeJson(block.input)
        });
      }
    }
    if (chunk.parsed.type === "content_block_delta" && isRecord(chunk.parsed.delta)) {
      const index = numberValue(chunk.parsed.index);
      const partialJson = stringValue(chunk.parsed.delta.partial_json);
      if (index !== undefined && partialJson !== undefined) {
        const current = streamedToolCalls.get(index);
        if (current) {
          current.inputText = `${current.inputText ?? ""}${partialJson}`;
          current.input = parseMaybeJson(current.inputText);
        }
      }
    }
  }
  toolCalls.push(...dedupeToolCalls([...streamedToolCalls.values()]));

  return {
    requestId,
    provider: "anthropic",
    model: stringValue(body.model) ?? stringValue(response.model),
    inputMessages: normalizeMessageArray(body.messages),
    outputMessages,
    toolCalls,
    usage
  };
}

function normalizeOpenAi(
  requestId: string,
  body: Record<string, unknown>,
  response: Record<string, unknown>,
  chunks: StreamChunk[],
  provider: Provider = "openai"
): LlmTrace {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const outputMessages = choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) return [];
    return normalizeMessage(choice.message);
  });
  const responseToolCalls = choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) return [];
    return extractOpenAiToolCalls(choice.message.tool_calls);
  });
  const streamToolCalls = extractOpenAiStreamToolCalls(chunks);

  return {
    requestId,
    provider,
    model: stringValue(body.model) ?? stringValue(response.model),
    inputMessages: normalizeMessageArray(body.messages ?? body.input),
    outputMessages,
    toolCalls: dedupeToolCalls([...responseToolCalls, ...streamToolCalls]),
    usage: normalizeOpenAiUsage(response.usage)
  };
}

function normalizeGoogle(requestId: string, body: Record<string, unknown>, response: Record<string, unknown>): LlmTrace {
  return {
    requestId,
    provider: "google",
    model: stringValue(body.model),
    inputMessages: normalizeMessageArray(body.contents),
    outputMessages: normalizeMessageArray(response.candidates),
    usage: normalizeGoogleUsage(response.usageMetadata)
  };
}

function normalizeMessageArray(value: unknown): NormalizedMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => normalizeMessage(item));
}

function normalizeMessage(value: unknown): NormalizedMessage[] {
  if (!isRecord(value)) return [];
  const role = normalizeRole(value.role);
  const content = stringifyContent(value.content ?? value.parts ?? value.text ?? value.message);
  return [{ id: cryptoId(), role, content, name: stringValue(value.name) }];
}

function normalizeAnthropicContent(value: unknown): NormalizedMessage[] {
  if (!Array.isArray(value)) return [];
  const text = value
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text") return stringValue(block.text) ?? "";
      if (block.type === "tool_use") return `tool_use ${stringValue(block.name) ?? "tool"}`;
      return stringifyContent(block);
    })
    .filter(Boolean)
    .join("\n");

  return text ? [{ id: cryptoId(), role: "assistant", content: text }] : [];
}

function extractAnthropicToolCalls(value: unknown): NormalizedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (!isRecord(block) || block.type !== "tool_use") return [];
    return {
      id: stringValue(block.id) ?? cryptoId(),
      name: stringValue(block.name) ?? "tool",
      input: block.input,
      inputText: stringifyMaybeJson(block.input)
    };
  });
}

function extractOpenAiToolCalls(value: unknown): NormalizedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((toolCall) => {
    if (!isRecord(toolCall)) return [];
    const fn = isRecord(toolCall.function) ? toolCall.function : {};
    const inputText = stringValue(fn.arguments);
    return {
      id: stringValue(toolCall.id) ?? cryptoId(),
      name: stringValue(fn.name) ?? stringValue(toolCall.name) ?? "tool",
      input: parseMaybeJson(inputText),
      inputText
    };
  });
}

function extractOpenAiStreamToolCalls(chunks: StreamChunk[]): NormalizedToolCall[] {
  const byIndex = new Map<number, NormalizedToolCall & { inputText?: string }>();

  for (const chunk of chunks) {
    if (!isRecord(chunk.parsed)) continue;
    const choices = Array.isArray(chunk.parsed.choices) ? chunk.parsed.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) continue;
      const toolCalls = Array.isArray(choice.delta.tool_calls) ? choice.delta.tool_calls : [];
      for (const toolCall of toolCalls) {
        if (!isRecord(toolCall)) continue;
        const index = numberValue(toolCall.index) ?? byIndex.size;
        const current = byIndex.get(index) ?? { id: cryptoId(), name: "tool", inputText: "" };
        const fn = isRecord(toolCall.function) ? toolCall.function : {};
        current.id = stringValue(toolCall.id) ?? current.id;
        current.name = stringValue(fn.name) ?? current.name;
        current.inputText = `${current.inputText ?? ""}${stringValue(fn.arguments) ?? ""}`;
        current.input = parseMaybeJson(current.inputText);
        byIndex.set(index, current);
      }
    }
  }

  return [...byIndex.values()];
}

function normalizeAnthropicUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: numberValue(value.input_tokens),
    outputTokens: numberValue(value.output_tokens)
  };
}

function normalizeOpenAiUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: numberValue(value.prompt_tokens ?? value.input_tokens),
    outputTokens: numberValue(value.completion_tokens ?? value.output_tokens),
    totalTokens: numberValue(value.total_tokens)
  };
}

function normalizeGoogleUsage(value: unknown): TokenUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    inputTokens: numberValue(value.promptTokenCount),
    outputTokens: numberValue(value.candidatesTokenCount),
    totalTokens: numberValue(value.totalTokenCount)
  };
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        if (isRecord(item) && typeof item.content === "string") return item.content;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function normalizeRole(value: unknown): NormalizedMessage["role"] {
  if (value === "system" || value === "user" || value === "assistant" || value === "tool") return value;
  if (value === "model") return "assistant";
  return "unknown";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 11);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stringifyMaybeJson(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function dedupeToolCalls(toolCalls: NormalizedToolCall[]): NormalizedToolCall[] {
  const seen = new Set<string>();
  const result: NormalizedToolCall[] = [];
  for (const toolCall of toolCalls) {
    const key = `${toolCall.id}:${toolCall.name}:${toolCall.inputText ?? JSON.stringify(toolCall.input)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(toolCall);
  }
  return result;
}

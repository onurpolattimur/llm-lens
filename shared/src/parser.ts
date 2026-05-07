import type {
  CapturedRequest,
  LlmTrace,
  NormalizedMessage,
  NormalizedReasoning,
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
  const reasoning = extractAnthropicReasoning(response.content);
  const usage = normalizeAnthropicUsage(response.usage);

  const streamedToolCalls = new Map<number, NormalizedToolCall & { inputText?: string }>();
  const streamedReasoning = new Map<number, NormalizedReasoning>();
  const streamedBlockTypes = new Map<number, string>();
  const streamedText = new Map<number, string>();
  for (const chunk of chunks) {
    if (!isRecord(chunk.parsed)) continue;
    if (chunk.parsed.type === "content_block_start" && isRecord(chunk.parsed.content_block)) {
      const block = chunk.parsed.content_block;
      const index = numberValue(chunk.parsed.index) ?? streamedBlockTypes.size;
      const blockType = stringValue(block.type);
      if (blockType) streamedBlockTypes.set(index, blockType);
      if (block.type === "text") streamedText.set(index, stringValue(block.text) ?? "");
      if (block.type === "tool_use") {
        streamedToolCalls.set(index, {
          id: stringValue(block.id) ?? cryptoId(),
          name: stringValue(block.name) ?? "tool",
          input: block.input,
          inputText: stringifyMaybeJson(block.input)
        });
      }
      if (block.type === "thinking" || block.type === "redacted_thinking") {
        streamedReasoning.set(index, {
          id: stringValue(block.signature) ?? cryptoId(),
          content: stringValue(block.thinking) ?? stringValue(block.text) ?? "[redacted thinking]",
          details: block
        });
      }
    }
    if (chunk.parsed.type === "content_block_delta" && isRecord(chunk.parsed.delta)) {
      const index = numberValue(chunk.parsed.index);
      const blockType = index !== undefined ? streamedBlockTypes.get(index) : undefined;
      const partialJson = stringValue(chunk.parsed.delta.partial_json);
      if (index !== undefined && partialJson !== undefined) {
        const current = streamedToolCalls.get(index);
        if (current) {
          current.inputText = `${current.inputText ?? ""}${partialJson}`;
          current.input = parseMaybeJson(current.inputText);
        }
      }
      const text = stringValue(chunk.parsed.delta.text);
      if (index !== undefined && text !== undefined && blockType === "text") {
        streamedText.set(index, `${streamedText.get(index) ?? ""}${text}`);
      }
      const thinking =
        stringValue(chunk.parsed.delta.thinking) ??
        (blockType === "thinking" || blockType === "redacted_thinking" ? text : undefined);
      if (index !== undefined && thinking !== undefined) {
        const current = streamedReasoning.get(index) ?? { id: cryptoId(), content: "" };
        current.content = `${current.content}${thinking}`;
        current.details = { ...(isRecord(current.details) ? current.details : {}), streamed: true };
        streamedReasoning.set(index, current);
      }
    }
  }
  toolCalls.push(...dedupeToolCalls([...streamedToolCalls.values()]));
  reasoning.push(...dedupeReasoning([...streamedReasoning.values()]));
  outputMessages.push(...dedupeMessages(streamedTextMessages(streamedText)));

  return {
    requestId,
    provider: "anthropic",
    model: stringValue(body.model) ?? stringValue(response.model),
    inputMessages: [...normalizeAnthropicSystem(body.system), ...normalizeMessageArray(body.messages)],
    outputMessages: dedupeMessages(outputMessages),
    toolCalls,
    reasoning,
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
  outputMessages.push(...extractOpenAiStreamMessages(chunks));
  const responseToolCalls = choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) return [];
    return extractOpenAiToolCalls(choice.message.tool_calls);
  });
  const streamToolCalls = extractOpenAiStreamToolCalls(chunks);
  const reasoning = dedupeReasoning([...extractOpenAiReasoning(choices), ...extractOpenAiStreamReasoning(chunks)]);

  return {
    requestId,
    provider,
    model: stringValue(body.model) ?? stringValue(response.model),
    inputMessages: normalizeMessageArray(body.messages ?? body.input),
    outputMessages: dedupeMessages(outputMessages),
    toolCalls: dedupeToolCalls([...responseToolCalls, ...streamToolCalls]),
    reasoning,
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

function normalizeAnthropicSystem(value: unknown): NormalizedMessage[] {
  if (value === undefined || value === null) return [];
  return [{ id: cryptoId(), role: "system", content: stringifyContent(value) }];
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

function streamedTextMessages(streamedText: Map<number, string>): NormalizedMessage[] {
  return [...streamedText.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, content]) => {
      if (!content.trim()) return [];
      return { id: cryptoId(), role: "assistant" as const, content };
    });
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

function extractAnthropicReasoning(value: unknown): NormalizedReasoning[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type !== "thinking" && block.type !== "redacted_thinking") return [];
    return {
      id: stringValue(block.signature) ?? cryptoId(),
      content: stringValue(block.thinking) ?? stringValue(block.text) ?? "[redacted thinking]",
      details: block
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

function extractOpenAiStreamMessages(chunks: StreamChunk[]): NormalizedMessage[] {
  const byIndex = new Map<number, { role: NormalizedMessage["role"]; content: string }>();

  for (const chunk of chunks) {
    if (!isRecord(chunk.parsed)) continue;
    const choices = Array.isArray(chunk.parsed.choices) ? chunk.parsed.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) continue;
      const index = numberValue(choice.index) ?? byIndex.size;
      const current = byIndex.get(index) ?? { role: "assistant", content: "" };
      current.role = normalizeRole(choice.delta.role) === "unknown" ? current.role : normalizeRole(choice.delta.role);
      current.content = `${current.content}${stringValue(choice.delta.content) ?? ""}`;
      byIndex.set(index, current);
    }
  }

  return [...byIndex.values()].flatMap((message) => {
    if (!message.content.trim()) return [];
    return { id: cryptoId(), role: message.role, content: message.content };
  });
}

function extractOpenAiReasoning(choices: unknown[]): NormalizedReasoning[] {
  return choices.flatMap((choice) => {
    if (!isRecord(choice) || !isRecord(choice.message)) return [];
    const content =
      stringValue(choice.message.reasoning) ??
      stringValue(choice.message.reasoning_content) ??
      stringifyReasoningDetails(choice.message.reasoning_details);
    if (!content) return [];
    return {
      id: stringValue(choice.message.id) ?? cryptoId(),
      content,
      details: choice.message.reasoning_details ?? choice.message.reasoning
    };
  });
}

function extractOpenAiStreamReasoning(chunks: StreamChunk[]): NormalizedReasoning[] {
  let content = "";
  const details: unknown[] = [];

  for (const chunk of chunks) {
    if (!isRecord(chunk.parsed)) continue;
    const choices = Array.isArray(chunk.parsed.choices) ? chunk.parsed.choices : [];
    for (const choice of choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) continue;
      content += stringValue(choice.delta.reasoning) ?? stringValue(choice.delta.reasoning_content) ?? "";
      if (choice.delta.reasoning_details !== undefined) details.push(choice.delta.reasoning_details);
    }
  }

  const detailsText = stringifyReasoningDetails(details.length ? details : undefined);
  const finalContent = content || detailsText;
  return finalContent ? [{ id: cryptoId(), content: finalContent, details: details.length ? details : undefined }] : [];
}

function stringifyReasoningDetails(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item)) {
          return stringValue(item.text) ?? stringValue(item.content) ?? stringValue(item.reasoning) ?? JSON.stringify(item);
        }
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join("\n");
    return text || undefined;
  }
  return JSON.stringify(value, null, 2);
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

function dedupeMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  const seen = new Set<string>();
  const result: NormalizedMessage[] = [];
  for (const message of messages) {
    const key = `${message.role}:${message.content}`;
    if (seen.has(key) || !message.content.trim()) continue;
    seen.add(key);
    result.push(message);
  }
  return result;
}

function dedupeReasoning(items: NormalizedReasoning[]): NormalizedReasoning[] {
  const seen = new Set<string>();
  const result: NormalizedReasoning[] = [];
  for (const item of items) {
    const key = `${item.id}:${item.content}`;
    if (seen.has(key) || !item.content.trim()) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

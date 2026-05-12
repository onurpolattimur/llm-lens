import type { CapturedRequest } from "@llm-lens/shared";

export type UsageSummary = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  billableTokens?: number;
  costUsd?: number;
};

export type TimelineSummary = {
  usage: UsageSummary;
  toolCalls: number;
  completedRequests: number;
  totalDurationMs?: number;
  firstStartedAt?: string;
  lastStartedAt?: string;
};

export function getUsageSummary(request: CapturedRequest): UsageSummary {
  const directUsage = mergeUsageSummaries(usageFromUnknown(responseUsage(request.responseBody)), usageFromUnknown(request.trace?.usage));
  const streamedUsage = usageFromStreamChunks(request);
  return withBillableTokens(mergeUsageSummaries(directUsage, streamedUsage));
}

export function getTimelineSummary(requests: CapturedRequest[]): TimelineSummary {
  const usageSummaries = requests.map(getUsageSummary);
  const startedAtValues = requests.map((request) => request.startedAt);

  return {
    usage: sumUsageSummaries(usageSummaries),
    toolCalls: requests.reduce((total, request) => total + toolCallCount(request), 0),
    completedRequests: requests.filter((request) => request.statusCode !== undefined || request.completedAt !== undefined || request.durationMs !== undefined).length,
    totalDurationMs: sumDefinedNumbers(requests.map((request) => request.durationMs)),
    firstStartedAt: minIsoDate(startedAtValues),
    lastStartedAt: maxIsoDate(startedAtValues)
  };
}

export function retainSelectedRequestId(selectedId: string | undefined, requests: CapturedRequest[]): string | undefined {
  return selectedId && requests.some((request) => request.id === selectedId) ? selectedId : undefined;
}

export function toggleSelectedRequestId(currentId: string | undefined, requestId: string): string | undefined {
  return currentId === requestId ? undefined : requestId;
}

export function toolCallCount(request: CapturedRequest): number {
  return request.trace?.toolCalls?.length ?? 0;
}

function sumUsageSummaries(summaries: UsageSummary[]): UsageSummary {
  return withBillableTokens(withoutUndefined({
    inputTokens: sumDefinedNumbers(summaries.map((summary) => summary.inputTokens)),
    outputTokens: sumDefinedNumbers(summaries.map((summary) => summary.outputTokens)),
    totalTokens: sumDefinedNumbers(summaries.map((summary) => summary.totalTokens)),
    cachedTokens: sumDefinedNumbers(summaries.map((summary) => summary.cachedTokens)),
    billableTokens: sumDefinedNumbers(summaries.map((summary) => summary.billableTokens)),
    costUsd: sumDefinedNumbers(summaries.map((summary) => summary.costUsd))
  }));
}

function usageFromStreamChunks(request: CapturedRequest): UsageSummary | undefined {
  for (let index = (request.streamChunks?.length ?? 0) - 1; index >= 0; index -= 1) {
    const usage = usageFromUnknown(responseUsage(request.streamChunks?.[index]?.parsed));
    if (usage) return usage;
  }
  return undefined;
}

function responseUsage(value: unknown): unknown {
  return isRecord(value) ? value.usage ?? value.usageMetadata : undefined;
}

function usageFromUnknown(value: unknown): UsageSummary | undefined {
  if (!isRecord(value)) return undefined;
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined;
  const summary = {
    inputTokens: numberValue(value.prompt_tokens ?? value.input_tokens ?? value.promptTokenCount ?? value.inputTokens),
    outputTokens: numberValue(value.completion_tokens ?? value.output_tokens ?? value.candidatesTokenCount ?? value.outputTokens),
    totalTokens: numberValue(value.total_tokens ?? value.totalTokenCount ?? value.totalTokens),
    cachedTokens: numberValue(value.cachedTokens ?? value.cache_read_input_tokens ?? value.cachedContentTokenCount ?? promptDetails?.cached_tokens),
    costUsd: numberValue(value.cost)
  };
  return Object.values(summary).some((item) => item !== undefined) ? summary : undefined;
}

function mergeUsageSummaries(base: UsageSummary | undefined, override: UsageSummary | undefined): UsageSummary {
  return { ...base, ...withoutUndefined(override) };
}

function withoutUndefined(value: UsageSummary | undefined): Partial<UsageSummary> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<UsageSummary>;
}

function withBillableTokens(usage: UsageSummary): UsageSummary {
  const totalTokens = usage.totalTokens ?? sumTokens(usage.inputTokens, usage.outputTokens);
  const usageWithTotal = totalTokens === undefined || usage.totalTokens !== undefined ? usage : { ...usage, totalTokens };
  if (totalTokens === undefined || usage.cachedTokens === undefined) return usageWithTotal;
  return { ...usageWithTotal, billableTokens: Math.max(totalTokens - usage.cachedTokens, 0) };
}

function sumTokens(inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function sumDefinedNumbers(values: Array<number | undefined>): number | undefined {
  let total = 0;
  let hasValue = false;

  for (const value of values) {
    if (value === undefined) continue;
    total += value;
    hasValue = true;
  }

  return hasValue ? total : undefined;
}

function minIsoDate(values: string[]): string | undefined {
  return selectIsoDate(values, (current, candidate) => candidate < current);
}

function maxIsoDate(values: string[]): string | undefined {
  return selectIsoDate(values, (current, candidate) => candidate > current);
}

function selectIsoDate(values: string[], shouldReplace: (current: number, candidate: number) => boolean): string | undefined {
  let selectedValue: string | undefined;
  let selectedTime: number | undefined;

  for (const value of values) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) continue;
    if (selectedTime === undefined || shouldReplace(selectedTime, time)) {
      selectedTime = time;
      selectedValue = value;
    }
  }

  return selectedValue;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import type { CapturedRequest } from "@llm-lens/shared";

export function filterTimelineRequests(requests: CapturedRequest[], query: string): CapturedRequest[] {
  const terms = parseSearchTerms(query);
  if (terms.length === 0) return requests;

  return requests.filter((request) => {
    const searchText = getRequestSearchText(request);
    return terms.every((term) => searchText.includes(term));
  });
}

function parseSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const termPattern = /"([^"]+)"|'([^']+)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = termPattern.exec(query)) !== null) {
    const term = normalizeSearchText(match[1] ?? match[2] ?? match[3] ?? "");
    if (term) terms.push(term);
  }

  return terms;
}

function getRequestSearchText(request: CapturedRequest): string {
  const parts: string[] = [
    request.id,
    request.provider,
    request.method,
    request.url,
    request.host,
    request.path,
    request.statusCode?.toString() ?? "",
    request.durationMs?.toString() ?? "",
    request.trace?.model ?? ""
  ];

  appendSearchValue(parts, request.requestBody);
  appendSearchValue(parts, request.responseBody);
  appendSearchValue(parts, request.trace?.inputMessages);
  appendSearchValue(parts, request.trace?.outputMessages);
  appendSearchValue(parts, request.trace?.reasoning);
  appendSearchValue(parts, request.trace?.toolCalls);
  appendSearchValue(parts, request.streamChunks?.map((chunk) => chunk.parsed));

  return normalizeSearchText(parts.join(" "));
}

function appendSearchValue(parts: string[], value: unknown, seen = new WeakSet<object>()) {
  if (value === undefined || value === null) return;

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => appendSearchValue(parts, item, seen));
    return;
  }

  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [key, item] of Object.entries(value)) {
    parts.push(key);
    appendSearchValue(parts, item, seen);
  }
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

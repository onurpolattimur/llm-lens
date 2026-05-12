import type { CapturedRequest, InspectorEvent } from "@llm-lens/shared";

export function applyInspectorEvent(current: CapturedRequest[], event: InspectorEvent): CapturedRequest[] {
  if (event.type === "snapshot") return event.requests;
  if (event.type === "request:start") return [event.request, ...current.filter((request) => request.id !== event.request.id)];
  if (event.type === "request:update") {
    return current.map((request) => (request.id === event.request.id ? event.request : request));
  }
  if (event.type === "stream:chunk") {
    return current.map((request) =>
      request.id === event.requestId
        ? { ...request, streamChunks: [...(request.streamChunks ?? []), event.chunk], streaming: true }
        : request
    );
  }
  if (event.type === "request:delete") return current.filter((request) => request.id !== event.requestId);
  if (event.type === "requests:clear") return [];
  return current;
}

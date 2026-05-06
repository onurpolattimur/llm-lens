import type { CapturedRequest, InspectorEvent, StreamChunk } from "@llm-inspector/shared";

const MAX_REQUESTS = 500;

export class EventStore {
  private requests = new Map<string, CapturedRequest>();
  private listeners = new Set<(event: InspectorEvent) => void>();

  list(): CapturedRequest[] {
    return [...this.requests.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): CapturedRequest | undefined {
    return this.requests.get(id);
  }

  start(request: CapturedRequest): void {
    this.requests.set(request.id, request);
    this.prune();
    this.emit({ type: "request:start", request });
  }

  update(id: string, patch: Partial<CapturedRequest>): CapturedRequest | undefined {
    const current = this.requests.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.requests.set(id, next);
    this.emit({ type: "request:update", request: next });
    return next;
  }

  addChunk(requestId: string, chunk: StreamChunk): void {
    const current = this.requests.get(requestId);
    if (!current) return;
    const streamChunks = [...(current.streamChunks ?? []), chunk];
    this.requests.set(requestId, { ...current, streamChunks, streaming: true });
    this.emit({ type: "stream:chunk", requestId, chunk });
  }

  subscribe(listener: (event: InspectorEvent) => void): () => void {
    this.listeners.add(listener);
    listener({ type: "snapshot", requests: this.list() });
    return () => this.listeners.delete(listener);
  }

  private emit(event: InspectorEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private prune(): void {
    const all = this.list();
    for (const request of all.slice(MAX_REQUESTS)) this.requests.delete(request.id);
  }
}


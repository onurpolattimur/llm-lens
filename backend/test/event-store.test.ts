import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest, InspectorEvent } from "@llm-lens/shared";
import { EventStore } from "../src/server/event-store.js";

test("exports sessions in newest-first order", () => {
  const store = new EventStore();
  store.start(capturedRequest({ id: "older", startedAt: "2026-05-12T10:00:00.000Z" }));
  store.start(capturedRequest({ id: "newer", startedAt: "2026-05-12T10:01:00.000Z" }));

  const session = store.exportSession();

  assert.equal(session.schemaVersion, 1);
  assert.equal(typeof session.exportedAt, "string");
  assert.deepEqual(session.requests.map((request) => request.id), ["newer", "older"]);
});

test("loads an imported session and emits a snapshot", () => {
  const store = new EventStore();
  const events: InspectorEvent[] = [];
  store.subscribe((event) => events.push(event));

  const loaded = store.loadSession({
    schemaVersion: 1,
    exportedAt: "2026-05-12T10:00:00.000Z",
    requests: [
      capturedRequest({ id: "older", startedAt: "2026-05-12T10:00:00.000Z" }),
      capturedRequest({ id: "newer", startedAt: "2026-05-12T10:01:00.000Z" })
    ]
  });

  assert.deepEqual(loaded.map((request) => request.id), ["newer", "older"]);
  assert.equal(events[events.length - 1]?.type, "snapshot");
  assert.deepEqual(store.list().map((request) => request.id), ["newer", "older"]);
});

test("clears and deletes requests with matching events", () => {
  const store = new EventStore();
  const events: InspectorEvent[] = [];
  store.start(capturedRequest({ id: "one" }));
  store.start(capturedRequest({ id: "two" }));
  store.subscribe((event) => events.push(event));

  assert.equal(store.delete("one"), true);
  assert.equal(store.delete("missing"), false);
  assert.deepEqual(store.list().map((request) => request.id), ["two"]);
  assert.deepEqual(events[events.length - 1], { type: "request:delete", requestId: "one" });

  store.clear();

  assert.deepEqual(store.list(), []);
  assert.deepEqual(events[events.length - 1], { type: "requests:clear" });
});

test("updates requests and appends stream chunks", () => {
  const store = new EventStore();
  const request = capturedRequest({ id: "streamed" });
  const chunk = { id: "chunk-1", requestId: "streamed", timestamp: "2026-05-12T10:00:00.100Z", raw: "data: {}", parsed: {} };

  store.start(request);
  const updated = store.update("streamed", { statusCode: 201, durationMs: 42 });
  store.addChunk("streamed", chunk);

  assert.equal(updated?.statusCode, 201);
  assert.equal(store.get("streamed")?.durationMs, 42);
  assert.deepEqual(store.get("streamed")?.streamChunks, [chunk]);
  assert.equal(store.get("streamed")?.streaming, true);
  assert.equal(store.update("missing", { statusCode: 404 }), undefined);
});

test("keeps only the newest 500 requests", () => {
  const store = new EventStore();

  for (let index = 0; index < 501; index += 1) {
    store.start(capturedRequest({ id: `request-${index}`, startedAt: new Date(Date.UTC(2026, 4, 12, 10, 0, index)).toISOString() }));
  }

  const ids = store.list().map((request) => request.id);
  assert.equal(ids.length, 500);
  assert.equal(ids.includes("request-0"), false);
  assert.equal(ids[0], "request-500");
});

function capturedRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id: "request-1",
    startedAt: "2026-05-12T10:00:00.000Z",
    provider: "openai",
    method: "POST",
    url: "https://api.openai.com/v1/chat/completions",
    host: "api.openai.com",
    path: "/v1/chat/completions",
    statusCode: 200,
    durationMs: 100,
    requestHeaders: {},
    responseHeaders: {},
    ...overrides
  };
}

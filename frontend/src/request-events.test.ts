import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest, InspectorEvent } from "@llm-lens/shared";
import { applyInspectorEvent } from "./request-events";

test("replaces requests when a snapshot event arrives", () => {
  const snapshot = [capturedRequest({ id: "snapshot-1" })];

  assert.deepEqual(applyInspectorEvent([capturedRequest({ id: "old" })], { type: "snapshot", requests: snapshot }), snapshot);
});

test("adds new request starts to the top and deduplicates existing ids", () => {
  const request = capturedRequest({ id: "same", startedAt: "2026-05-12T10:02:00.000Z" });
  const current = [capturedRequest({ id: "other" }), capturedRequest({ id: "same" })];

  assert.deepEqual(applyInspectorEvent(current, { type: "request:start", request }).map((item) => item.id), ["same", "other"]);
});

test("updates only the matching captured request", () => {
  const current = [capturedRequest({ id: "one", statusCode: 200 }), capturedRequest({ id: "two", statusCode: 200 })];
  const event: InspectorEvent = { type: "request:update", request: capturedRequest({ id: "two", statusCode: 500 }) };

  assert.deepEqual(applyInspectorEvent(current, event).map((item) => [item.id, item.statusCode]), [
    ["one", 200],
    ["two", 500]
  ]);
});

test("appends stream chunks and marks the request as streaming", () => {
  const chunk = { id: "chunk-1", requestId: "request-1", timestamp: "2026-05-12T10:00:00.100Z", raw: "data: {}", parsed: {} };
  const result = applyInspectorEvent([capturedRequest({ id: "request-1" })], { type: "stream:chunk", requestId: "request-1", chunk });

  assert.deepEqual(result[0]?.streamChunks, [chunk]);
  assert.equal(result[0]?.streaming, true);
});

test("deletes one request and clears all requests", () => {
  const current = [capturedRequest({ id: "one" }), capturedRequest({ id: "two" })];

  assert.deepEqual(applyInspectorEvent(current, { type: "request:delete", requestId: "one" }).map((item) => item.id), ["two"]);
  assert.deepEqual(applyInspectorEvent(current, { type: "requests:clear" }), []);
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

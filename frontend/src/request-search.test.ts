import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest } from "@llm-lens/shared";
import { filterTimelineRequests } from "./request-search";

type CapturedRequestTestOverrides = Omit<Partial<CapturedRequest>, "trace"> & {
  trace?: Partial<NonNullable<CapturedRequest["trace"]>>;
};

test("returns every request when the search query is empty", () => {
  const requests = [capturedRequest({ id: "request-1" }), capturedRequest({ id: "request-2" })];

  assert.deepEqual(filterTimelineRequests(requests, "   "), requests);
});

test("filters timeline requests by conversation messages", () => {
  const requests = [
    capturedRequest({
      id: "refund",
      trace: {
        inputMessages: [{ id: "message-1", role: "user", content: "Find failed refund for order 4812" }],
        outputMessages: [{ id: "message-2", role: "assistant", content: "Refund investigation completed." }]
      }
    }),
    capturedRequest({
      id: "invoice",
      trace: {
        inputMessages: [{ id: "message-3", role: "user", content: "Create an invoice summary" }],
        outputMessages: [{ id: "message-4", role: "assistant", content: "Invoice generated." }]
      }
    })
  ];

  assert.deepEqual(filterTimelineRequests(requests, "refund completed").map((request) => request.id), ["refund"]);
});

test("supports quoted phrases and searches tool call data", () => {
  const requests = [
    capturedRequest({
      id: "billing",
      trace: {
        toolCalls: [{ id: "tool-1", name: "lookup_account", input: { query: "billing cycle renewal" } }]
      }
    }),
    capturedRequest({
      id: "shipping",
      trace: {
        toolCalls: [{ id: "tool-2", name: "lookup_shipment", input: { query: "shipping cycle audit" } }]
      }
    })
  ];

  assert.deepEqual(filterTimelineRequests(requests, "\"billing cycle\" lookup_account").map((request) => request.id), ["billing"]);
});

test("matches raw request and response bodies when parsed conversation fields are missing", () => {
  const requests = [
    capturedRequest({ id: "raw-1", requestBody: { prompt: "Summarize failed payment retries" }, responseBody: { result: "retry plan ready" } }),
    capturedRequest({ id: "raw-2", requestBody: { prompt: "Write a changelog" }, responseBody: { result: "release notes ready" } })
  ];

  assert.deepEqual(filterTimelineRequests(requests, "payment retry").map((request) => request.id), ["raw-1"]);
});

test("normalizes case and diacritics for conversation search", () => {
  const requests = [
    capturedRequest({
      id: "turkish",
      trace: {
        inputMessages: [{ id: "message-1", role: "user", content: "Gelişmiş arama için İstanbul kayıtlarını bul" }]
      }
    })
  ];

  assert.deepEqual(filterTimelineRequests(requests, "GELISMIS istanbul").map((request) => request.id), ["turkish"]);
});

test("returns no requests when every search term cannot be found in the same conversation", () => {
  const requests = [
    capturedRequest({ id: "one", trace: { inputMessages: [{ id: "message-1", role: "user", content: "refund status" }] } }),
    capturedRequest({ id: "two", trace: { inputMessages: [{ id: "message-2", role: "user", content: "invoice completed" }] } })
  ];

  assert.deepEqual(filterTimelineRequests(requests, "refund completed"), []);
});

function capturedRequest(overrides: CapturedRequestTestOverrides = {}): CapturedRequest {
  const { trace, ...requestOverrides } = overrides;
  const request: CapturedRequest = {
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
    ...requestOverrides
  };

  if (trace !== undefined) {
    request.trace = {
      requestId: request.id,
      provider: request.provider,
      ...trace
    };
  }

  return request;
}

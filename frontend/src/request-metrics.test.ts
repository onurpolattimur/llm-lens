import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest } from "@llm-lens/shared";
import {
  getTimelineSummary,
  getUsageSummary,
  retainSelectedRequestId,
  toggleSelectedRequestId,
  toolCallCount
} from "./request-metrics";

type CapturedRequestTestOverrides = Omit<Partial<CapturedRequest>, "trace"> & {
  trace?: Partial<NonNullable<CapturedRequest["trace"]>>;
};

test("summarizes a single request from normalized trace usage and raw response cost", () => {
  const request = capturedRequest({
    responseBody: {
      usage: {
        prompt_tokens: 1,
        completion_tokens: 2,
        total_tokens: 3,
        cost: 0.001
      }
    },
    trace: {
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        cachedTokens: 20
      },
      toolCalls: [{ id: "tool-1", name: "lookup", input: {} }]
    }
  });

  assert.deepEqual(getUsageSummary(request), {
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    cachedTokens: 20,
    costUsd: 0.001,
    billableTokens: 130
  });
  assert.equal(toolCallCount(request), 1);
});

test("prefers the latest stream usage when a streaming response contains final usage", () => {
  const request = capturedRequest({
    responseBody: {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cost: 0.001
      }
    },
    streamChunks: [
      { id: "chunk-1", requestId: "request-1", timestamp: "2026-05-12T10:00:00.100Z", raw: "{}", parsed: { usage: { total_tokens: 10 } } },
      {
        id: "chunk-2",
        requestId: "request-1",
        timestamp: "2026-05-12T10:00:00.200Z",
        raw: "{}",
        parsed: {
          usage: {
            input_tokens: 120,
            output_tokens: 60,
            total_tokens: 180,
            cache_read_input_tokens: 30,
            cost: 0.0015
          }
        }
      }
    ]
  });

  assert.deepEqual(getUsageSummary(request), {
    inputTokens: 120,
    outputTokens: 60,
    totalTokens: 180,
    cachedTokens: 30,
    costUsd: 0.0015,
    billableTokens: 150
  });
});

test("aggregates timeline totals across captured requests", () => {
  const requests = [
    capturedRequest({
      id: "request-1",
      startedAt: "2026-05-12T10:00:00.000Z",
      completedAt: "2026-05-12T10:00:01.200Z",
      durationMs: 1200,
      responseBody: { usage: { cost: 0.001 } },
      trace: {
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cachedTokens: 20 },
        toolCalls: [
          { id: "tool-1", name: "one", input: {} },
          { id: "tool-2", name: "two", input: {} }
        ]
      }
    }),
    capturedRequest({
      id: "request-2",
      startedAt: "2026-05-12T10:01:00.000Z",
      completedAt: "2026-05-12T10:01:00.800Z",
      durationMs: 800,
      responseBody: { usage: { cost: 0.002 } },
      trace: {
        usage: { inputTokens: 200, outputTokens: 100, cachedTokens: 0 },
        toolCalls: [{ id: "tool-3", name: "three", input: {} }]
      }
    })
  ];

  assert.deepEqual(getTimelineSummary(requests), {
    usage: {
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
      cachedTokens: 20,
      costUsd: 0.003,
      billableTokens: 430
    },
    toolCalls: 3,
    completedRequests: 2,
    totalDurationMs: 2000,
    firstStartedAt: "2026-05-12T10:00:00.000Z",
    lastStartedAt: "2026-05-12T10:01:00.000Z"
  });
});

test("returns undefined totals when no request has the relevant metric", () => {
  const summary = getTimelineSummary([
    capturedRequest({ id: "pending-1", statusCode: undefined, durationMs: undefined, trace: undefined }),
    capturedRequest({ id: "pending-2", statusCode: undefined, durationMs: undefined, trace: undefined })
  ]);

  assert.deepEqual(summary.usage, {});
  assert.equal(summary.completedRequests, 0);
  assert.equal(summary.totalDurationMs, undefined);
  assert.equal(summary.toolCalls, 0);
});

test("retains selection only while the selected request still exists", () => {
  const requests = [capturedRequest({ id: "request-1" }), capturedRequest({ id: "request-2" })];

  assert.equal(retainSelectedRequestId("request-1", requests), "request-1");
  assert.equal(retainSelectedRequestId("missing", requests), undefined);
  assert.equal(retainSelectedRequestId(undefined, requests), undefined);
});

test("toggles selected request back to aggregate mode when clicked again", () => {
  assert.equal(toggleSelectedRequestId(undefined, "request-1"), "request-1");
  assert.equal(toggleSelectedRequestId("request-1", "request-1"), undefined);
  assert.equal(toggleSelectedRequestId("request-1", "request-2"), "request-2");
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

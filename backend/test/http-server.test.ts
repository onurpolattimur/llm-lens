import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest } from "@llm-lens/shared";
import { parseSessionExport } from "../src/server/session-import.js";

test("parses valid session exports for import", () => {
  const request = capturedRequest({ id: "imported" });
  const session = parseSessionExport({
    schemaVersion: 1,
    exportedAt: "2026-05-12T10:00:00.000Z",
    requests: [request]
  });

  assert.deepEqual(session, {
    schemaVersion: 1,
    exportedAt: "2026-05-12T10:00:00.000Z",
    requests: [request]
  });
});

test("fills exportedAt when a valid import omits it", () => {
  const session = parseSessionExport({
    schemaVersion: 1,
    requests: [capturedRequest()]
  });

  assert.equal(session?.schemaVersion, 1);
  assert.equal(typeof session?.exportedAt, "string");
  assert.equal(session?.requests.length, 1);
});

test("rejects invalid session imports", () => {
  assert.equal(parseSessionExport({ schemaVersion: 2, requests: [capturedRequest()] }), undefined);
  assert.equal(parseSessionExport({ schemaVersion: 1, requests: "not-array" }), undefined);
  assert.equal(parseSessionExport({ schemaVersion: 1, requests: [{ ...capturedRequest(), provider: "bad-provider" }] }), undefined);
  assert.equal(parseSessionExport({ schemaVersion: 1, requests: [{ ...capturedRequest(), requestHeaders: { authorization: 123 } }] }), undefined);
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

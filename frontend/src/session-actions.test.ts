import assert from "node:assert/strict";
import test from "node:test";
import type { CapturedRequest } from "@llm-lens/shared";
import {
  clearCapturedRequests,
  deleteCapturedRequest,
  exportSessionFile,
  getFilename,
  importSessionFile
} from "./session-actions";

test("exports the session and downloads it with the server-provided filename", async () => {
  const blob = new Blob([JSON.stringify({ schemaVersion: 1, requests: [] })], { type: "application/json" });
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const downloads: Array<{ blob: Blob; filename: string }> = [];
  const fetchFn = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    fetchCalls.push({ input: String(input), init });
    return new Response(blob, {
      status: 200,
      headers: { "content-disposition": 'attachment; filename="session.json"' }
    });
  };

  await exportSessionFile("http://127.0.0.1:9292", fetchFn, (downloadBlob, filename) => {
    downloads.push({ blob: downloadBlob, filename });
  });

  assert.deepEqual(fetchCalls, [{ input: "http://127.0.0.1:9292/api/session/export", init: undefined }]);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0]?.blob.type, "application/json");
  assert.equal(await downloads[0]?.blob.text(), await blob.text());
  assert.equal(downloads[0]?.filename, "session.json");
});

test("throws when session export fails", async () => {
  const fetchFn = async () => new Response("fail", { status: 500 });

  await assert.rejects(() => exportSessionFile("http://api", fetchFn, () => undefined), /Export failed/);
});

test("imports a session file and returns server-normalized requests", async () => {
  const session = { schemaVersion: 1, exportedAt: "2026-05-12T10:00:00.000Z", requests: [capturedRequest({ id: "uploaded" })] };
  const importedRequests = [capturedRequest({ id: "server-normalized" })];
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const file = { text: async () => JSON.stringify(session) };
  const fetchFn = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    fetchCalls.push({ input: String(input), init });
    return Response.json({ requests: importedRequests });
  };

  const result = await importSessionFile("http://127.0.0.1:9292", file, fetchFn);

  assert.deepEqual(result, importedRequests);
  assert.equal(fetchCalls[0]?.input, "http://127.0.0.1:9292/api/session/import");
  assert.equal(fetchCalls[0]?.init?.method, "POST");
  assert.deepEqual(fetchCalls[0]?.init?.headers, { "content-type": "application/json" });
  assert.equal(fetchCalls[0]?.init?.body, JSON.stringify(session));
});

test("returns undefined and skips fetch when no import file is selected", async () => {
  let called = false;
  const fetchFn = async () => {
    called = true;
    return Response.json({});
  };

  assert.equal(await importSessionFile("http://api", undefined, fetchFn), undefined);
  assert.equal(called, false);
});

test("throws when session import fails or contains invalid JSON", async () => {
  await assert.rejects(
    () => importSessionFile("http://api", { text: async () => JSON.stringify({ schemaVersion: 1 }) }, async () => new Response("fail", { status: 400 })),
    /Import failed/
  );
  await assert.rejects(() => importSessionFile("http://api", { text: async () => "not-json" }, async () => Response.json({})), SyntaxError);
});

test("clears all captured requests with DELETE", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchFn = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push({ input: String(input), init });
    return Response.json({ ok: true });
  };

  await clearCapturedRequests("http://api", fetchFn);

  assert.deepEqual(calls, [{ input: "http://api/api/requests", init: { method: "DELETE" } }]);
});

test("deletes one captured request with encoded id", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetchFn = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    calls.push({ input: String(input), init });
    return Response.json({ ok: true });
  };

  await deleteCapturedRequest("http://api", "request/with space", fetchFn);

  assert.deepEqual(calls, [{ input: "http://api/api/requests/request%2Fwith%20space", init: { method: "DELETE" } }]);
});

test("throws when clear or delete requests fail", async () => {
  const fetchFn = async () => new Response("fail", { status: 500 });

  await assert.rejects(() => clearCapturedRequests("http://api", fetchFn), /Clear failed/);
  await assert.rejects(() => deleteCapturedRequest("http://api", "request-1", fetchFn), /Delete failed/);
});

test("parses content-disposition filenames", () => {
  assert.equal(getFilename('attachment; filename="llm-lens-session.json"'), "llm-lens-session.json");
  assert.equal(getFilename("attachment"), undefined);
  assert.equal(getFilename(null), undefined);
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

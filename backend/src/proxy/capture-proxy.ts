import { Proxy, type IContext } from "http-mitm-proxy";
import { nanoid } from "nanoid";
import { brotliDecompressSync, gunzipSync, inflateSync, unzipSync } from "node:zlib";
import {
  detectProvider,
  isAllowedLlmHost,
  type CapturedRequest,
  type StreamChunk
} from "@llm-lens/shared";
import { normalizeTrace, parseJsonBody, parseSseChunks } from "@llm-lens/shared/parser";
import { redactHeaders } from "@llm-lens/shared/redaction";
import type { EventStore } from "../server/event-store.js";
import { certRootDir } from "../cert/paths.js";
import { installProxyLogFilter, isBenignProxyError } from "./proxy-log-filter.js";

const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;

type CaptureState = {
  id: string;
  startedAtMs: number;
  requestChunks: Buffer[];
  responseChunks: Buffer[];
  responseBytes: number;
  requestBytes: number;
  capture: boolean;
};

export type CaptureProxyOptions = {
  host: string;
  port: number;
  store: EventStore;
  additionalProviderHosts?: string[];
};

export async function startCaptureProxy(options: CaptureProxyOptions): Promise<{ close: () => void }> {
  installProxyLogFilter();
  const proxy = new Proxy();

  proxy.onError((ctx, err, kind) => {
    if (isBenignProxyError(kind, err)) return;
    const id = getState(ctx)?.id;
    if (id) options.store.update(id, { error: `${kind ?? "proxy"}: ${err?.message ?? "unknown error"}` });
    else console.error("proxy error:", kind, err);
  });

  proxy.onRequest((ctx, callback) => {
    const host = headerValue(ctx.clientToProxyRequest.headers.host);
    const capture = Boolean(host && isAllowedLlmHost(host, options.additionalProviderHosts));
    const id = nanoid();
    setState(ctx, {
      id,
      startedAtMs: Date.now(),
      requestChunks: [],
      responseChunks: [],
      requestBytes: 0,
      responseBytes: 0,
      capture
    });

    if (!capture) return callback();

    ctx.clientToProxyRequest.headers["accept-encoding"] = "identity";
    const request: CapturedRequest = {
      id,
      startedAt: new Date().toISOString(),
      provider: detectProvider(host),
      method: ctx.clientToProxyRequest.method ?? "GET",
      url: buildUrl(ctx, host),
      host,
      path: ctx.clientToProxyRequest.url ?? "/",
      requestHeaders: redactHeaders(ctx.clientToProxyRequest.headers)
    };

    options.store.start(request);
    return callback();
  });

  proxy.onRequestData((ctx, chunk, callback) => {
    const state = getState(ctx);
    if (state?.capture && state.requestBytes < MAX_CAPTURE_BYTES) {
      state.requestBytes += chunk.length;
      state.requestChunks.push(chunk);
    }
    return callback(null, chunk);
  });

  proxy.onRequestEnd((ctx, callback) => {
    const state = getState(ctx);
    if (state?.capture) {
      options.store.update(state.id, {
        requestBody: parseJsonBody(Buffer.concat(state.requestChunks))
      });
    }
    return callback();
  });

  proxy.onResponse((ctx, callback) => {
    const state = getState(ctx);
    if (state?.capture && ctx.serverToProxyResponse) {
      options.store.update(state.id, {
        statusCode: ctx.serverToProxyResponse.statusCode,
        responseHeaders: redactHeaders(ctx.serverToProxyResponse.headers),
        streaming: isSse(ctx.serverToProxyResponse.headers["content-type"])
      });
    }
    return callback();
  });

  proxy.onResponseData((ctx, chunk, callback) => {
    const state = getState(ctx);
    if (state?.capture && state.responseBytes < MAX_CAPTURE_BYTES) {
      state.responseBytes += chunk.length;
      state.responseChunks.push(chunk);

      if (isSse(ctx.serverToProxyResponse?.headers["content-type"]) && !hasEncodedBody(ctx)) {
        for (const parsed of parseSseChunks(state.id, chunk.toString("utf8"))) {
          options.store.addChunk(state.id, parsed);
        }
      }
    }
    return callback(null, chunk);
  });

  proxy.onResponseEnd((ctx, callback) => {
    const state = getState(ctx);
    if (state?.capture) {
      const responseBuffer = decodeResponseBuffer(Buffer.concat(state.responseChunks), ctx);
      const responseText = responseBuffer.toString("utf8");
      const current = options.store.get(state.id);
      const sseChunks = isSse(ctx.serverToProxyResponse?.headers["content-type"])
        ? parseSseChunks(state.id, responseText)
        : [];
      const streamChunks = mergeChunks(current?.streamChunks ?? [], sseChunks);
      const completedAt = new Date().toISOString();
      const partial = {
        completedAt,
        durationMs: Date.now() - state.startedAtMs,
        responseBody: isSse(ctx.serverToProxyResponse?.headers["content-type"])
          ? responseText
          : parseJsonBody(responseText),
        streamChunks,
        streaming: streamChunks.length > 0
      } satisfies Partial<CapturedRequest>;

      const updated = options.store.update(state.id, partial);
      if (updated) options.store.update(state.id, { trace: normalizeTrace(updated) });
    }
    return callback();
  });

  await new Promise<void>((resolve) => {
    proxy.listen(
      {
        host: options.host,
        port: options.port,
        sslCaDir: certRootDir(),
        forceChunkedRequest: true
      },
      () => resolve()
    );
  });

  return { close: () => proxy.close() };
}

function buildUrl(ctx: IContext, host: string): string {
  const rawUrl = ctx.clientToProxyRequest.url ?? "/";
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) return rawUrl;
  return `${ctx.isSSL ? "https" : "http"}://${host}${rawUrl}`;
}

function isSse(contentType: string | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType.join(",") : contentType ?? "";
  return value.toLowerCase().includes("text/event-stream");
}

function hasEncodedBody(ctx: IContext): boolean {
  return contentEncodings(ctx).length > 0;
}

function decodeResponseBuffer(buffer: Buffer, ctx: IContext): Buffer {
  let decoded = buffer;
  for (const encoding of [...contentEncodings(ctx)].reverse()) {
    try {
      if (encoding === "gzip" || encoding === "x-gzip") decoded = gunzipSync(decoded);
      else if (encoding === "br") decoded = brotliDecompressSync(decoded);
      else if (encoding === "deflate") decoded = inflateSync(decoded);
      else if (encoding === "zlib") decoded = unzipSync(decoded);
    } catch {
      return buffer;
    }
  }
  return decoded;
}

function contentEncodings(ctx: IContext): string[] {
  const value = headerValue(ctx.serverToProxyResponse?.headers["content-encoding"]);
  return value
    .split(",")
    .map((encoding) => encoding.trim().toLowerCase())
    .filter(Boolean);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getState(ctx: IContext | null | undefined): CaptureState | undefined {
  return ctx?.tags?.llmInspector as CaptureState | undefined;
}

function setState(ctx: IContext, state: CaptureState): void {
  const tags = (ctx.tags ?? {}) as Record<string, unknown>;
  tags.llmInspector = state;
  ctx.tags = tags as IContext["tags"];
}

function mergeChunks(existing: StreamChunk[], incoming: StreamChunk[]): StreamChunk[] {
  const seen = new Set(existing.map((chunk) => `${chunk.raw}:${JSON.stringify(chunk.parsed)}`));
  const merged = [...existing];
  for (const chunk of incoming) {
    const key = `${chunk.raw}:${JSON.stringify(chunk.parsed)}`;
    if (!seen.has(key)) merged.push(chunk);
  }
  return merged;
}

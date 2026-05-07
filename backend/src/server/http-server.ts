import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { EventStore, InspectorSessionExport } from "./event-store.js";
import type { CapturedRequest } from "@llm-inspector/shared";

const SESSION_IMPORT_BODY_LIMIT_BYTES = 50 * 1024 * 1024;
const PROVIDERS = new Set(["anthropic", "openai", "openrouter", "google", "unknown"]);

export type InspectorServerOptions = {
  host: string;
  port: number;
  store: EventStore;
};

export type InspectorUiServerOptions = {
  host: string;
  port: number;
  apiBaseUrl: string;
  proxyUrl: string;
};

export async function startInspectorServer(options: InspectorServerOptions): Promise<{ close: () => Promise<void> }> {
  const app = Fastify({ logger: false, bodyLimit: SESSION_IMPORT_BODY_LIMIT_BYTES });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/requests", async () => options.store.list());
  app.delete("/api/requests", async () => {
    options.store.clear();
    return { ok: true };
  });
  app.get("/api/session/export", async (_request, reply) => {
    reply.header("content-disposition", `attachment; filename="llm-inspector-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json"`);
    return options.store.exportSession();
  });
  app.post<{ Body: unknown }>("/api/session/import", async (request, reply) => {
    const session = parseSessionExport(request.body);
    if (!session) return reply.code(400).send({ error: "Invalid session export" });
    return { requests: options.store.loadSession(session) };
  });
  app.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const captured = options.store.get(request.params.id);
    if (!captured) return reply.code(404).send({ error: "Request not found" });
    return captured;
  });
  app.delete<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    if (!options.store.delete(request.params.id)) return reply.code(404).send({ error: "Request not found" });
    return { ok: true };
  });

  await app.listen({ host: options.host, port: options.port });
  const wss = new WebSocketServer({ server: app.server, path: "/events" });

  wss.on("connection", (socket) => {
    const unsubscribe = options.store.subscribe((event) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
  });

  return {
    close: async () => {
      wss.close();
      await app.close();
    }
  };
}

function parseSessionExport(value: unknown): InspectorSessionExport | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.requests)) return undefined;
  const requests = value.requests.filter(isCapturedRequest);
  if (requests.length !== value.requests.length) return undefined;
  return {
    schemaVersion: 1,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : new Date().toISOString(),
    requests
  };
}

function isCapturedRequest(value: unknown): value is CapturedRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.provider === "string" &&
    PROVIDERS.has(value.provider) &&
    typeof value.method === "string" &&
    typeof value.url === "string" &&
    typeof value.host === "string" &&
    typeof value.path === "string" &&
    isStringRecord(value.requestHeaders)
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startInspectorUiServer(options: InspectorUiServerOptions): Promise<{ close: () => Promise<void> } | undefined> {
  const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend/dist");
  if (!existsSync(resolve(frontendDist, "index.html"))) return undefined;

  const app = Fastify({ logger: false });
  app.get("/config.js", async (_request, reply) => {
    reply.type("application/javascript");
    return `window.__LLM_INSPECTOR_CONFIG__=${JSON.stringify({
      apiBaseUrl: options.apiBaseUrl,
      proxyUrl: options.proxyUrl
    })};`;
  });
  await app.register(staticFiles, {
    root: frontendDist,
    prefix: "/"
  });
  app.setNotFoundHandler((_request, reply) => reply.sendFile("index.html"));
  await app.listen({ host: options.host, port: options.port });

  return {
    close: async () => {
      await app.close();
    }
  };
}

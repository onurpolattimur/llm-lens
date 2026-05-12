import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import Fastify from "fastify";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import type { EventStore } from "./event-store.js";
import { parseSessionExport } from "./session-import.js";

const SESSION_IMPORT_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

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
    reply.header("content-disposition", `attachment; filename="llm-lens-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json"`);
    return options.store.exportSession();
  });
  app.post<{ Body: unknown }>("/api/session/import", async (request, reply) => {
    const session = parseSessionExport(request.body);
    if (!session) return reply.code(400).send({ error: "Invalid session export" });
    const requests = options.store.loadSession(session);
    return { ok: true, requestCount: requests.length };
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

export async function startInspectorUiServer(options: InspectorUiServerOptions): Promise<{ close: () => Promise<void> } | undefined> {
  const frontendDist = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend/dist");
  if (!existsSync(resolve(frontendDist, "index.html"))) return undefined;

  const app = Fastify({ logger: false });
  app.get("/config.js", async (_request, reply) => {
    reply.type("application/javascript");
    return `window.__LLM_LENS_CONFIG__=${JSON.stringify({
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

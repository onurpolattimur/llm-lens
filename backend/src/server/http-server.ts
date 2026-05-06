import cors from "@fastify/cors";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import type { EventStore } from "./event-store.js";

export type InspectorServerOptions = {
  host: string;
  port: number;
  store: EventStore;
};

export async function startInspectorServer(options: InspectorServerOptions): Promise<{ close: () => Promise<void> }> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true }));
  app.get("/api/requests", async () => options.store.list());
  app.get<{ Params: { id: string } }>("/api/requests/:id", async (request, reply) => {
    const captured = options.store.get(request.params.id);
    if (!captured) return reply.code(404).send({ error: "Request not found" });
    return captured;
  });

  const address = await app.listen({ host: options.host, port: options.port });
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


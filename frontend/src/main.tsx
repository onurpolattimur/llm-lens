import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRightLeft,
  Braces,
  Clock,
  KeyRound,
  MessageSquareText,
  Radio,
  Rows3,
  TerminalSquare,
  Wrench
} from "lucide-react";
import type { CapturedRequest, InspectorEvent, NormalizedMessage, NormalizedToolCall } from "@llm-inspector/shared";
import "./styles.css";

const API_BASE = import.meta.env.VITE_INSPECTOR_API ?? "http://127.0.0.1:3000";
const WS_BASE = API_BASE.replace(/^http/, "ws");

type Tab = "conversation" | "exchange" | "raw" | "headers" | "chunks";

function App() {
  const [requests, setRequests] = React.useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [tab, setTab] = React.useState<Tab>("conversation");
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    fetch(`${API_BASE}/api/requests`)
      .then((response) => response.json())
      .then((data: CapturedRequest[]) => {
        setRequests(data);
        setSelectedId((current) => current ?? data[0]?.id);
      })
      .catch(() => undefined);

    const socket = new WebSocket(`${WS_BASE}/events`);
    socket.addEventListener("open", () => setConnected(true));
    socket.addEventListener("close", () => setConnected(false));
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(message.data) as InspectorEvent;
      setRequests((current) => applyEvent(current, event));
      if (event.type === "request:start") setSelectedId((current) => current ?? event.request.id);
    });
    return () => socket.close();
  }, []);

  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Local MITM Debugger</div>
          <h1>LLM Inspector</h1>
        </div>
        <div className="status-strip">
          <StatusPill active={connected} label={connected ? "Live feed" : "Disconnected"} />
          <div className="proxy-chip">
            <Radio size={16} />
            <span>Proxy 127.0.0.1:8080</span>
          </div>
        </div>
      </header>

      <section className="workspace">
        <aside className="timeline">
          <div className="panel-heading">
            <Rows3 size={18} />
            <span>Timeline</span>
            <strong>{requests.length}</strong>
          </div>
          <div className="timeline-list">
            {requests.length === 0 ? (
              <EmptyTimeline />
            ) : (
              requests.map((request) => (
                <button
                  className={`timeline-item ${request.id === selected?.id ? "selected" : ""}`}
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                >
                  <div className="item-primary">
                    <span className={`provider provider-${request.provider}`}>{request.provider}</span>
                    <span>{formatTime(request.startedAt)}</span>
                  </div>
                  <div className="item-model">{request.trace?.model ?? request.path}</div>
                  {toolCallCount(request) > 0 ? (
                    <div className="tool-indicator">
                      <Wrench size={13} />
                      <span>{toolCallCount(request)} tool call{toolCallCount(request) === 1 ? "" : "s"}</span>
                    </div>
                  ) : null}
                  <div className="item-meta">
                    <span>{request.statusCode ?? "pending"}</span>
                    <span>{request.durationMs ? `${request.durationMs}ms` : request.streaming ? "streaming" : "open"}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="detail">
          {selected ? (
            <>
              <RequestHeader request={selected} />
              <nav className="tabs">
                <TabButton active={tab === "conversation"} icon={<MessageSquareText size={16} />} onClick={() => setTab("conversation")}>
                  Conversation
                </TabButton>
                <TabButton active={tab === "exchange"} icon={<ArrowRightLeft size={16} />} onClick={() => setTab("exchange")}>
                  Exchange
                </TabButton>
                <TabButton active={tab === "raw"} icon={<Braces size={16} />} onClick={() => setTab("raw")}>
                  Raw
                </TabButton>
                <TabButton active={tab === "headers"} icon={<KeyRound size={16} />} onClick={() => setTab("headers")}>
                  Headers
                </TabButton>
                <TabButton active={tab === "chunks"} icon={<TerminalSquare size={16} />} onClick={() => setTab("chunks")}>
                  Chunks
                </TabButton>
              </nav>
              <div className="tab-body">
                {tab === "conversation" && <Conversation request={selected} />}
                {tab === "exchange" && <ExchangeView request={selected} />}
                {tab === "raw" && <JsonBlock value={{ request: selected.requestBody, response: selected.responseBody }} />}
                {tab === "headers" && <JsonBlock value={{ request: selected.requestHeaders, response: selected.responseHeaders }} />}
                {tab === "chunks" && <JsonBlock value={selected.streamChunks ?? []} />}
              </div>
            </>
          ) : (
            <div className="empty-detail">
              <Activity size={36} />
              <h2>Waiting for LLM traffic</h2>
              <p>Start an agent with HTTP_PROXY and HTTPS_PROXY pointed at the local proxy.</p>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function ExchangeView({ request }: { request: CapturedRequest }) {
  return (
    <div className="exchange-view">
      <ExchangePanel
        tone="request"
        title="Request"
        meta={[
          ["Method", request.method],
          ["Host", request.host],
          ["Path", request.path]
        ]}
        headers={request.requestHeaders}
        body={request.requestBody}
      />
      <ExchangePanel
        tone="response"
        title="Response"
        meta={[
          ["Status", request.statusCode ?? "pending"],
          ["Duration", request.durationMs ? `${request.durationMs}ms` : "open"],
          ["Streaming", request.streaming ? "yes" : "no"]
        ]}
        headers={request.responseHeaders}
        body={request.responseBody}
        toolCalls={request.trace?.toolCalls}
      />
    </div>
  );
}

function ExchangePanel({
  tone,
  title,
  meta,
  headers,
  body,
  toolCalls
}: {
  tone: "request" | "response";
  title: string;
  meta: Array<[string, React.ReactNode]>;
  headers?: Record<string, string>;
  body: unknown;
  toolCalls?: NormalizedToolCall[];
}) {
  return (
    <article className={`exchange-panel exchange-${tone}`}>
      <header className="exchange-heading">
        <div>
          <span>{tone === "request" ? "Client to provider" : "Provider to client"}</span>
          <h2>{title}</h2>
        </div>
        <div className="exchange-direction">{tone === "request" ? "OUT" : "IN"}</div>
      </header>

      <dl className="exchange-meta">
        {meta.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className="exchange-section">
        <h3>Headers</h3>
        <KeyValueTable value={headers ?? {}} />
      </section>

      <section className="exchange-section">
        <h3>Body</h3>
        <PrettyBody value={body} />
      </section>

      {toolCalls?.length ? (
        <section className="exchange-section">
          <ToolCallsPanel toolCalls={toolCalls} />
        </section>
      ) : null}
    </article>
  );
}

function KeyValueTable({ value }: { value: Record<string, string> }) {
  const entries = Object.entries(value);
  if (entries.length === 0) return <div className="empty-inline">No headers captured</div>;

  return (
    <div className="kv-table">
      {entries.map(([key, item]) => (
        <React.Fragment key={key}>
          <div className="kv-key">{key}</div>
          <div className="kv-value">{item}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

function PrettyBody({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === "") return <div className="empty-inline">No body captured</div>;
  return <pre className="pretty-body">{formatJson(value)}</pre>;
}

function RequestHeader({ request }: { request: CapturedRequest }) {
  return (
    <div className="request-header">
      <div>
        <div className="route-line">
          <span className={`provider provider-${request.provider}`}>{request.provider}</span>
          <strong>{request.method}</strong>
          <code>{request.path}</code>
        </div>
        <div className="url-line">{request.url}</div>
      </div>
      <div className="metrics">
        <Metric label="Tools" value={toolCallCount(request) || "-"} />
        <Metric label="Status" value={request.statusCode ?? "-"} />
        <Metric label="Duration" value={request.durationMs ? `${request.durationMs}ms` : "-"} />
        <Metric label="Started" value={formatTime(request.startedAt)} />
      </div>
    </div>
  );
}

function Conversation({ request }: { request: CapturedRequest }) {
  const input = request.trace?.inputMessages ?? [];
  const output = request.trace?.outputMessages ?? [];
  const messages = [...input, ...output];

  if (messages.length === 0) {
    return <JsonBlock value={request.trace ?? request.requestBody ?? request.responseBody ?? "No parsed conversation yet."} />;
  }

  return (
    <div className="conversation">
      {request.trace?.toolCalls?.length ? <ToolCallsPanel toolCalls={request.trace.toolCalls} /> : null}
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

function ToolCallsPanel({ toolCalls }: { toolCalls: NormalizedToolCall[] }) {
  return (
    <section className="tool-call-list">
      <div className="tool-call-heading">
        <Wrench size={17} />
        <h3>Tool calls</h3>
        <span>{toolCalls.length}</span>
      </div>
      {toolCalls.map((tool, index) => (
        <article className="tool-call" key={`${tool.id}-${index}`}>
          <div className="tool-call-title">
            <strong>{tool.name}</strong>
            <code>{tool.id}</code>
          </div>
          <pre>{formatJson(tool.input ?? tool.inputText ?? {})}</pre>
        </article>
      ))}
    </section>
  );
}

function MessageBubble({ message }: { message: NormalizedMessage }) {
  return (
    <article className={`message message-${message.role}`}>
      <div className="message-role">{message.role}</div>
      <pre>{message.content}</pre>
    </article>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{formatJson(value)}</pre>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TabButton({
  active,
  icon,
  children,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={`tab-button ${active ? "active" : ""}`} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </button>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`status-pill ${active ? "active" : ""}`}>
      <span />
      {label}
    </div>
  );
}

function EmptyTimeline() {
  return (
    <div className="empty-timeline">
      <Clock size={22} />
      <span>No captured requests</span>
    </div>
  );
}

function applyEvent(current: CapturedRequest[], event: InspectorEvent): CapturedRequest[] {
  if (event.type === "snapshot") return event.requests;
  if (event.type === "request:start") return [event.request, ...current.filter((request) => request.id !== event.request.id)];
  if (event.type === "request:update") {
    return current.map((request) => (request.id === event.request.id ? event.request : request));
  }
  if (event.type === "stream:chunk") {
    return current.map((request) =>
      request.id === event.requestId
        ? { ...request, streamChunks: [...(request.streamChunks ?? []), event.chunk], streaming: true }
        : request
    );
  }
  return current;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function formatJson(value: unknown): string {
  if (typeof value === "string") {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

function toolCallCount(request: CapturedRequest): number {
  return request.trace?.toolCalls?.length ?? 0;
}

createRoot(document.getElementById("root")!).render(<App />);

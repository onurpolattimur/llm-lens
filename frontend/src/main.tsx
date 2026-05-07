import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowRightLeft,
  Braces,
  Clock,
  Download,
  Loader2,
  KeyRound,
  MessageSquareText,
  Monitor,
  Moon,
  Radio,
  Rows3,
  Sun,
  Trash2,
  Upload,
  TerminalSquare,
  Wrench
} from "lucide-react";
import type {
  CapturedRequest,
  InspectorEvent,
  NormalizedMessage,
  NormalizedReasoning,
  NormalizedToolCall
} from "@llm-lens/shared";
import "./styles.css";

declare global {
  interface Window {
    __LLM_LENS_CONFIG__?: {
      apiBaseUrl?: string;
      proxyUrl?: string;
    };
  }
}

const runtimeConfig = window.__LLM_LENS_CONFIG__ ?? {};
const API_BASE = runtimeConfig.apiBaseUrl ?? import.meta.env.VITE_LENS_API ?? window.location.origin;
const WS_BASE = API_BASE.replace(/^http/, "ws");
const PROXY_URL = runtimeConfig.proxyUrl ?? import.meta.env.VITE_LENS_PROXY_URL ?? "http://127.0.0.1:9191";

type Tab = "conversation" | "exchange" | "raw" | "headers" | "chunks";
type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "llm-lens-theme";
const LEGACY_THEME_STORAGE_KEY = "llm-inspector-theme";

function App() {
  const [requests, setRequests] = React.useState<CapturedRequest[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();
  const [tab, setTab] = React.useState<Tab>("conversation");
  const [connected, setConnected] = React.useState(false);
  const [sessionBusy, setSessionBusy] = React.useState<"export" | "import" | undefined>();
  const [deleteBusy, setDeleteBusy] = React.useState<string | undefined>();
  const [sessionError, setSessionError] = React.useState<string | undefined>();
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const theme = useThemePreference();

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
      if (event.type === "request:delete") setSelectedId((current) => (current === event.requestId ? undefined : current));
      if (event.type === "requests:clear") setSelectedId(undefined);
    });
    return () => socket.close();
  }, []);

  React.useEffect(() => {
    setSelectedId((current) => (current && requests.some((request) => request.id === current) ? current : requests[0]?.id));
  }, [requests]);

  const selected = requests.find((request) => request.id === selectedId) ?? requests[0];

  async function exportSession() {
    setSessionBusy("export");
    setSessionError(undefined);
    try {
      const response = await fetch(`${API_BASE}/api/session/export`);
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      downloadBlob(blob, getFilename(response.headers.get("content-disposition")) ?? defaultExportFilename());
    } catch {
      setSessionError("Session export failed.");
    } finally {
      setSessionBusy(undefined);
    }
  }

  async function importSession(file: File | undefined) {
    if (!file) return;
    setSessionBusy("import");
    setSessionError(undefined);
    try {
      const session = JSON.parse(await file.text()) as unknown;
      const response = await fetch(`${API_BASE}/api/session/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(session)
      });
      if (!response.ok) throw new Error("Import failed");
      const data = (await response.json()) as { requests: CapturedRequest[] };
      setRequests(data.requests);
      setSelectedId(data.requests[0]?.id);
    } catch {
      setSessionError("Session load failed.");
    } finally {
      setSessionBusy(undefined);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function clearRequests() {
    if (requests.length === 0) return;
    setDeleteBusy("all");
    setSessionError(undefined);
    try {
      const response = await fetch(`${API_BASE}/api/requests`, { method: "DELETE" });
      if (!response.ok) throw new Error("Clear failed");
      setRequests([]);
      setSelectedId(undefined);
    } catch {
      setSessionError("Requests could not be cleared.");
    } finally {
      setDeleteBusy(undefined);
    }
  }

  async function deleteRequest(id: string) {
    setDeleteBusy(id);
    setSessionError(undefined);
    try {
      const response = await fetch(`${API_BASE}/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Delete failed");
      setRequests((current) => current.filter((request) => request.id !== id));
    } catch {
      setSessionError("Request could not be deleted.");
    } finally {
      setDeleteBusy(undefined);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Local MITM Debugger</div>
          <h1>LLM Lens</h1>
        </div>
        <div className="status-strip">
          <StatusPill active={connected} label={connected ? "Live feed" : "Disconnected"} />
          <div className="proxy-chip">
            <Radio size={16} />
            <span>Proxy {formatProxyUrl(PROXY_URL)}</span>
          </div>
          <button className="session-button" onClick={exportSession} disabled={sessionBusy !== undefined || requests.length === 0} title="Export session">
            {sessionBusy === "export" ? <Loader2 className="spin-icon" size={16} /> : <Download size={16} />}
            <span>Export</span>
          </button>
          <button className="session-button" onClick={() => importInputRef.current?.click()} disabled={sessionBusy !== undefined} title="Load session">
            {sessionBusy === "import" ? <Loader2 className="spin-icon" size={16} /> : <Upload size={16} />}
            <span>Load</span>
          </button>
          <button
            className="session-button danger-button"
            onClick={() => void clearRequests()}
            disabled={deleteBusy !== undefined || requests.length === 0}
            title="Clear requests"
          >
            {deleteBusy === "all" ? <Loader2 className="spin-icon" size={16} /> : <Trash2 size={16} />}
            <span>Clear</span>
          </button>
          <ThemeToggle preference={theme.preference} resolvedTheme={theme.resolvedTheme} onToggle={theme.togglePreference} />
          <input
            ref={importInputRef}
            className="session-file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importSession(event.currentTarget.files?.[0])}
          />
          {sessionError ? <div className="session-error">{sessionError}</div> : null}
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
                <article
                  className={`timeline-item ${request.id === selected?.id ? "selected" : ""}`}
                  key={request.id}
                  onClick={() => setSelectedId(request.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(request.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="item-primary">
                    <span className={`provider provider-${request.provider}`}>{request.provider}</span>
                    <div className="item-actions">
                      <span>{formatTime(request.startedAt)}</span>
                      <button
                        className="timeline-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteRequest(request.id);
                        }}
                        disabled={deleteBusy !== undefined}
                        title="Delete request"
                      >
                        {deleteBusy === request.id ? <Loader2 className="spin-icon" size={13} /> : <Trash2 size={13} />}
                      </button>
                    </div>
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
                </article>
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
  const usage = getUsageSummary(request);

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
        <Metric label="Cost" value={formatCost(usage.costUsd)} />
        <Metric label="Tokens" value={formatTokens(usage.totalTokens)} />
        <Metric label="Cache Read" value={formatTokens(usage.cachedTokens)} />
        <Metric label="Charged Tokens" value={formatTokens(usage.billableTokens)} />
        <Metric label="In / Out" value={formatTokenPair(usage.inputTokens, usage.outputTokens)} />
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
  const reasoning = request.trace?.reasoning ?? [];
  const toolCalls = request.trace?.toolCalls ?? [];

  if (input.length === 0 && output.length === 0 && reasoning.length === 0 && toolCalls.length === 0) {
    return <JsonBlock value={request.trace ?? request.requestBody ?? request.responseBody ?? "No parsed conversation yet."} />;
  }

  return <TraceFlow input={input} output={output} reasoning={reasoning} toolCalls={toolCalls} />;
}

function TraceFlow({
  input,
  output,
  reasoning,
  toolCalls
}: {
  input: NormalizedMessage[];
  output: NormalizedMessage[];
  reasoning: NormalizedReasoning[];
  toolCalls: NormalizedToolCall[];
}) {
  return (
    <div className="trace-flow">
      {input.map((message) => (
        <TraceItem
          key={message.id}
          direction="request"
          kind={message.role === "system" ? "System prompt" : message.role}
          title={message.role === "system" ? summarize(message.content, 96) : summarize(message.content, 120)}
          detail={message.content}
        />
      ))}

      {reasoning.map((item) => (
        <TraceItem
          key={item.id}
          direction="response"
          kind="Reasoning"
          title={summarize(item.content, 140)}
          detail={formatJson(item.details ?? item.content)}
          emphasis="reasoning"
        />
      ))}

      {toolCalls.map((tool, index) => (
        <TraceItem
          key={`${tool.id}-${index}`}
          direction="response"
          kind="Tool call request"
          title={`${tool.name}${tool.input ? ` ${summarize(formatJson(tool.input), 90)}` : ""}`}
          detail={formatJson({ id: tool.id, name: tool.name, input: tool.input ?? tool.inputText })}
          emphasis="tool"
        />
      ))}

      {output.map((message) => (
        <TraceItem
          key={message.id}
          direction="response"
          kind={message.role}
          title={summarize(message.content, 140)}
          detail={message.content}
        />
      ))}
    </div>
  );
}

function TraceItem({
  direction,
  kind,
  title,
  detail,
  emphasis
}: {
  direction: "request" | "response";
  kind: string;
  title: string;
  detail: string;
  emphasis?: "reasoning" | "tool";
}) {
  return (
    <article className={`trace-item trace-${direction} ${emphasis ? `trace-${emphasis}` : ""}`} tabIndex={0}>
      <div className="trace-line">
        <span className="trace-arrow">{direction === "request" ? "-->" : "<--"}</span>
        <span className="trace-kind">{kind}</span>
        <span className="trace-title">{title || "(empty)"}</span>
      </div>
      <div className="trace-popover">
        <pre>{detail}</pre>
      </div>
    </article>
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

type UsageSummary = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  billableTokens?: number;
  costUsd?: number;
};

function getUsageSummary(request: CapturedRequest): UsageSummary {
  const directUsage = mergeUsageSummaries(usageFromUnknown(responseUsage(request.responseBody)), usageFromUnknown(request.trace?.usage));
  const streamedUsage = usageFromStreamChunks(request);
  return withBillableTokens(mergeUsageSummaries(directUsage, streamedUsage));
}

function usageFromStreamChunks(request: CapturedRequest): UsageSummary | undefined {
  for (let index = (request.streamChunks?.length ?? 0) - 1; index >= 0; index -= 1) {
    const usage = usageFromUnknown(responseUsage(request.streamChunks?.[index]?.parsed));
    if (usage) return usage;
  }
  return undefined;
}

function responseUsage(value: unknown): unknown {
  return isRecord(value) ? value.usage ?? value.usageMetadata : undefined;
}

function usageFromUnknown(value: unknown): UsageSummary | undefined {
  if (!isRecord(value)) return undefined;
  const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : undefined;
  const summary = {
    inputTokens: numberValue(value.prompt_tokens ?? value.input_tokens ?? value.promptTokenCount),
    outputTokens: numberValue(value.completion_tokens ?? value.output_tokens ?? value.candidatesTokenCount),
    totalTokens: numberValue(value.total_tokens ?? value.totalTokenCount),
    cachedTokens: numberValue(value.cachedTokens ?? value.cache_read_input_tokens ?? value.cachedContentTokenCount ?? promptDetails?.cached_tokens),
    costUsd: numberValue(value.cost)
  };
  return Object.values(summary).some((item) => item !== undefined) ? summary : undefined;
}

function mergeUsageSummaries(base: UsageSummary | undefined, override: UsageSummary | undefined): UsageSummary {
  return { ...base, ...withoutUndefined(override) };
}

function withoutUndefined(value: UsageSummary | undefined): Partial<UsageSummary> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<UsageSummary>;
}

function withBillableTokens(usage: UsageSummary): UsageSummary {
  const totalTokens = usage.totalTokens ?? sumTokens(usage.inputTokens, usage.outputTokens);
  if (totalTokens === undefined || usage.cachedTokens === undefined) return usage;
  return { ...usage, billableTokens: Math.max(totalTokens - usage.cachedTokens, 0) };
}

function sumTokens(inputTokens: number | undefined, outputTokens: number | undefined): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function formatCost(value: number | undefined): string {
  if (value === undefined) return "-";
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokens(value: number | undefined): string {
  if (value === undefined) return "-";
  return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

function formatTokenPair(input: number | undefined, output: number | undefined): string {
  if (input === undefined && output === undefined) return "-";
  return `${formatTokens(input)} / ${formatTokens(output)}`;
}

function formatProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.host;
  } catch {
    return value.replace(/^https?:\/\//, "");
  }
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

function ThemeToggle({
  preference,
  resolvedTheme,
  onToggle
}: {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  onToggle: () => void;
}) {
  const Icon = preference === "light" ? Sun : preference === "dark" ? Moon : Monitor;
  const nextPreference = nextThemePreference(preference, resolvedTheme);
  const currentLabel = themePreferenceLabel(preference);
  const resolvedLabel = themePreferenceLabel(resolvedTheme);
  const nextLabel = themePreferenceLabel(nextPreference);
  const title =
    preference === "system"
      ? `Theme: ${currentLabel} (${resolvedLabel}). Switch to ${nextLabel}.`
      : `Theme: ${currentLabel}. Switch to ${nextLabel}.`;

  return (
    <button className="theme-toggle" type="button" onClick={onToggle} title={title} aria-label={title}>
      <Icon size={18} strokeWidth={2.25} />
    </button>
  );
}

function useThemePreference() {
  const [preference, setPreference] = React.useState<ThemePreference>(() => readThemePreference());
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>(() => getSystemTheme());
  const resolvedTheme = preference === "system" ? systemTheme : preference;

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const updateSystemTheme = () => setSystemTheme(media.matches ? "light" : "dark");

    updateSystemTheme();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updateSystemTheme);
      return () => media.removeEventListener("change", updateSystemTheme);
    }

    media.addListener(updateSystemTheme);
    return () => media.removeListener(updateSystemTheme);
  }, []);

  React.useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;

    try {
      if (preference === "system") {
        localStorage.removeItem(THEME_STORAGE_KEY);
      } else {
        localStorage.setItem(THEME_STORAGE_KEY, preference);
      }
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      // Theme still works for the current page when localStorage is unavailable.
    }
  }, [preference, resolvedTheme]);

  return {
    preference,
    resolvedTheme,
    togglePreference: () => setPreference((current) => nextThemePreference(current, current === "system" ? systemTheme : current))
  };
}

function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) ?? localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function nextThemePreference(preference: ThemePreference, resolvedTheme: ResolvedTheme): ThemePreference {
  if (preference === "system") return resolvedTheme === "dark" ? "light" : "dark";
  if (preference === "light") return "dark";
  return "system";
}

function themePreferenceLabel(preference: ThemePreference | ResolvedTheme): string {
  if (preference === "system") return "System";
  if (preference === "light") return "Light";
  return "Dark";
}

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
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
  if (event.type === "request:delete") return current.filter((request) => request.id !== event.requestId);
  if (event.type === "requests:clear") return [];
  return current;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function getFilename(contentDisposition: string | null): string | undefined {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1];
}

function defaultExportFilename(): string {
  return `llm-lens-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
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

function summarize(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}...`;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

createRoot(document.getElementById("root")!).render(<App />);

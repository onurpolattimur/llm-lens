import type { CapturedRequest } from "@llm-lens/shared";

export type SessionDownload = (blob: Blob, filename: string) => void;
export type FetchLike = typeof fetch;

export async function exportSessionFile(apiBaseUrl: string, fetchFn: FetchLike, download: SessionDownload): Promise<void> {
  const response = await fetchFn(`${apiBaseUrl}/api/session/export`);
  if (!response.ok) throw new Error("Export failed");
  const blob = await response.blob();
  download(blob, getFilename(response.headers.get("content-disposition")) ?? defaultExportFilename());
}

export async function importSessionFile(apiBaseUrl: string, file: Pick<File, "text"> | undefined, fetchFn: FetchLike): Promise<CapturedRequest[] | undefined> {
  if (!file) return undefined;

  const response = await fetchFn(`${apiBaseUrl}/api/session/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await file.text()
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response, "Import failed"));
  const data = await response.json() as unknown;
  return isRecord(data) && Array.isArray(data.requests) ? data.requests as CapturedRequest[] : undefined;
}

export async function clearCapturedRequests(apiBaseUrl: string, fetchFn: FetchLike): Promise<void> {
  const response = await fetchFn(`${apiBaseUrl}/api/requests`, { method: "DELETE" });
  if (!response.ok) throw new Error("Clear failed");
}

export async function deleteCapturedRequest(apiBaseUrl: string, id: string, fetchFn: FetchLike): Promise<void> {
  const response = await fetchFn(`${apiBaseUrl}/api/requests/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Delete failed");
}

export function getFilename(contentDisposition: string | null): string | undefined {
  const match = contentDisposition?.match(/filename="([^"]+)"/);
  return match?.[1];
}

export function defaultExportFilename(): string {
  return `llm-lens-session-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const value = await response.json() as unknown;
    if (isRecord(value) && typeof value.message === "string") return value.message;
    if (isRecord(value) && typeof value.error === "string") return value.error;
  } catch {
    return fallback;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  const session = JSON.parse(await file.text()) as unknown;
  const response = await fetchFn(`${apiBaseUrl}/api/session/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(session)
  });
  if (!response.ok) throw new Error("Import failed");
  const data = (await response.json()) as { requests: CapturedRequest[] };
  return data.requests;
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

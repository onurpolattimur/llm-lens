import { logger } from "../logger.js";

const BENIGN_ERROR_KINDS = new Set([
  "HTTPS_CLIENT_ERROR",
  "CLIENT_TO_PROXY_SOCKET_ERROR",
  "PROXY_TO_CLIENT_RESPONSE_ERROR",
  "CLIENT_TO_PROXY_REQUEST_ERROR"
]);

let installed = false;

export function installProxyLogFilter(): void {
  if (installed) return;
  installed = true;

  console.debug = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === "string" && arg.startsWith("Got ECONNRESET on "))) return;
    logger.debug(...args);
  };

  console.error = (...args: unknown[]) => {
    if (args.length === 1 && isBenignProxyLog(args[0])) return;
    logger.error(...args);
  };
}

export function isBenignProxyError(kind: string | undefined, error: unknown): boolean {
  return Boolean(kind && BENIGN_ERROR_KINDS.has(kind) && isBenignSocketError(error));
}

function isBenignProxyLog(value: unknown): boolean {
  if (typeof value === "string") {
    return BENIGN_ERROR_KINDS.has(value) || value === "Socket error:";
  }
  return isBenignSocketError(value);
}

function isBenignSocketError(value: unknown): boolean {
  if (!(value instanceof Error)) return false;
  const error = value as NodeJS.ErrnoException;
  return error.code === "ECONNRESET" || error.message === "socket hang up";
}

import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { inspectorHome } from "./cert/paths.js";

type LogLevel = "info" | "error" | "debug";

type LoggerState = {
  filePath?: string;
  mirrorToTerminal: boolean;
  debugToTerminal: boolean;
};

const terminal = {
  log: console.log.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console)
};

let state: LoggerState = {
  mirrorToTerminal: true,
  debugToTerminal: false
};

export const logger = {
  info: (...args: unknown[]) => write("info", args),
  error: (...args: unknown[]) => write("error", args),
  debug: (...args: unknown[]) => write("debug", args)
};

export function createSessionLogFile(): string {
  const logDir = path.join(inspectorHome(), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(logDir, `session-${timestamp}.log`);
}

export function routeLogsToFile(filePath: string, options: { mirrorToTerminal: boolean }): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  state = {
    filePath,
    mirrorToTerminal: options.mirrorToTerminal,
    debugToTerminal: options.mirrorToTerminal
  };
}

export function routeLogsToTerminal(options: { debugToTerminal?: boolean } = {}): void {
  state = {
    mirrorToTerminal: true,
    debugToTerminal: options.debugToTerminal ?? false
  };
}

function write(level: LogLevel, args: unknown[]): void {
  if (state.filePath) {
    fs.appendFileSync(state.filePath, `${formatLine(level, args)}\n`, "utf8");
  }

  if (!shouldWriteToTerminal(level)) return;

  if (level === "error") terminal.error(...args);
  else if (level === "debug") terminal.debug(...args);
  else terminal.log(...args);
}

function shouldWriteToTerminal(level: LogLevel): boolean {
  if (level === "debug") return state.debugToTerminal;
  return state.mirrorToTerminal;
}

function formatLine(level: LogLevel, args: unknown[]): string {
  return `[${new Date().toISOString()}] ${level.toUpperCase()} ${util.format(...args)}`;
}

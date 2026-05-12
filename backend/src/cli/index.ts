#!/usr/bin/env node
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { parseProviderHosts } from "@llm-lens/shared";
import { EventStore } from "../server/event-store.js";
import { startInspectorServer, startInspectorUiServer } from "../server/http-server.js";
import { startCaptureProxy } from "../proxy/capture-proxy.js";
import { createSessionLogFile, logger, routeLogsToFile, routeLogsToTerminal } from "../logger.js";
import {
  ensureCertificate,
  installCertificateTrust,
  printCertStatus,
  uninstallCertificateTrust
} from "../cert/cert-cli.js";
import { rootCaPath } from "../cert/paths.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PROXY_PORT = "9191";
const DEFAULT_API_PORT = "9292";
const DEFAULT_UI_PORT = "5270";
const ADDITIONAL_PROVIDER_URLS_ENV = "LLM_LENS_ADDITIONAL_PROVIDER_URLS";
const PACKAGE_VERSION = readPackageVersion();

loadEnvFiles();

type InspectorOptions = {
  proxyPort: string;
  apiPort: string;
  uiPort: string;
  host: string;
  additionalProviderUrls: string;
  uiServer: boolean;
  verbose: boolean;
};

type CloseHandle = {
  close: () => void | Promise<void>;
};

type InspectorRuntime = {
  proxyUrl: string;
  apiBaseUrl: string;
  uiUrl: string;
  uiServerStarted: boolean;
  caPath: string;
  additionalProviderHosts: string[];
  close: () => Promise<void>;
};

const program = new Command();

program
  .name("llm-lens")
  .description("Local LLM API debugging proxy")
  .version(PACKAGE_VERSION)
  .enablePositionalOptions();

addInspectorOptions(program)
  .argument("[agent-command]", "agent command to run through the proxy")
  .argument("[agent-args...]", "arguments passed to the agent command")
  .allowExcessArguments()
  .passThroughOptions()
  .action(async (agentCommand: string | undefined, agentArgs: string[], options: InspectorOptions) => {
    if (!agentCommand) {
      program.help();
      return;
    }
    await runAgentCommand(agentCommand, agentArgs, options);
  });

addInspectorOptions(program.command("start").description("start the proxy, API, and web UI"))
  .action(async (options: InspectorOptions) => {
    routeLogsToTerminal({ debugToTerminal: options.verbose });
    const runtime = await startInspector(options);
    printInspectorStarted(runtime);
    openBrowserIfUiIsAvailable(runtime);
    console.log("");
    console.log("To inspect Claude Code / Node.js agents:");
    console.log(`  export HTTPS_PROXY=${runtime.proxyUrl}`);
    console.log(`  export HTTP_PROXY=${runtime.proxyUrl}`);
    console.log("  export NO_PROXY=localhost,127.0.0.1");
    console.log(`  export NODE_EXTRA_CA_CERTS="${runtime.caPath}"`);
    console.log(`  export SSL_CERT_FILE="${runtime.caPath}"`);
    if (options.verbose) {
      console.log("");
      console.log("Verbose logging enabled.");
    }
  });

addInspectorOptions(program.command("run").description("start the inspector and run an agent command"))
  .argument("<agent-command>", "agent command to run through the proxy")
  .argument("[agent-args...]", "arguments passed to the agent command")
  .allowExcessArguments()
  .passThroughOptions()
  .action(async (agentCommand: string, agentArgs: string[], options: InspectorOptions) => {
    await runAgentCommand(agentCommand, agentArgs, options);
  });

program
  .command("cert")
  .argument("<action>", "generate | install | status | uninstall")
  .action(async (action: string) => {
    if (action === "generate") {
      console.log(await ensureCertificate());
      return;
    }
    if (action === "install") return installCertificateTrust();
    if (action === "status") return printCertStatus();
    if (action === "uninstall") return uninstallCertificateTrust();
    throw new Error(`Unknown cert action: ${action}`);
  });

await program.parseAsync();

function addInspectorOptions(command: Command): Command {
  return command
    .option("--proxy-port <port>", "proxy port", envValue("LLM_LENS_PROXY_PORT", DEFAULT_PROXY_PORT))
    .option("--api-port <port>", "API/WebSocket port", envValue("LLM_LENS_API_PORT", DEFAULT_API_PORT))
    .option("--ui-port <port>", "web UI port", envValue("LLM_LENS_UI_PORT", DEFAULT_UI_PORT))
    .option("--host <host>", "bind host", envValue("LLM_LENS_HOST", DEFAULT_HOST))
    .option("--additional-provider-urls <urls>", "extra provider hosts or URLs to capture", envValue(ADDITIONAL_PROVIDER_URLS_ENV, ""))
    .option("--verbose", "mirror background runtime logs to the terminal while running an agent", envFlag("LLM_LENS_VERBOSE"))
    .option("--no-ui-server", "do not serve the built web UI");
}

async function startInspector(options: InspectorOptions): Promise<InspectorRuntime> {
  await ensureCertificate();
  const host = options.host;
  const proxyPort = options.proxyPort;
  const apiPort = options.apiPort;
  const uiPort = options.uiPort;
  const proxyUrl = `http://${host}:${proxyPort}`;
  const apiBaseUrl = `http://${host}:${apiPort}`;
  const uiUrl = `http://${host}:${uiPort}`;
  const additionalProviderHosts = parseProviderHosts(options.additionalProviderUrls);
  const store = new EventStore();
  const handles: CloseHandle[] = [];
  let uiServerStarted = false;

  try {
    const apiServer = await startInspectorServer({ host, port: Number(apiPort), store });
    handles.push(apiServer);

    if (options.uiServer) {
      const uiServer = await startInspectorUiServer({
        host,
        port: Number(uiPort),
        apiBaseUrl,
        proxyUrl
      });
      if (uiServer) {
        uiServerStarted = true;
        handles.push(uiServer);
      }
    }

    const proxyServer = await startCaptureProxy({
      host,
      port: Number(proxyPort),
      store,
      additionalProviderHosts
    });
    handles.push(proxyServer);

    return {
      proxyUrl,
      apiBaseUrl,
      uiUrl,
      uiServerStarted,
      caPath: rootCaPath(),
      additionalProviderHosts,
      close: () => closeHandles(handles)
    };
  } catch (error) {
    await closeHandles(handles);
    throw error;
  }
}

async function runAgentCommand(agentCommand: string, agentArgs: string[], options: InspectorOptions): Promise<void> {
  const runtime = await startInspector(options);
  printInspectorStarted(runtime);
  openBrowserIfUiIsAvailable(runtime);

  const normalizedArgs = normalizeAgentArgs(agentArgs);
  const logFile = createSessionLogFile();
  console.log("");
  console.log(`Running through proxy: ${[agentCommand, ...normalizedArgs].join(" ")}`);
  console.log(`LLM Lens background log: ${logFile}`);
  if (options.verbose) {
    console.log("Verbose mode: background logs will also be printed here.");
  }
  console.log("");

  try {
    routeLogsToFile(logFile, { mirrorToTerminal: options.verbose });
    logger.info("Running through proxy: %s", [agentCommand, ...normalizedArgs].join(" "));
    logger.info("Proxy: %s", runtime.proxyUrl);
    logger.info("API/WebSocket: %s", runtime.apiBaseUrl);
    logger.info("Web UI: %s", runtime.uiServerStarted ? runtime.uiUrl : "not served");
    const result = await spawnAgent(agentCommand, normalizedArgs, runtime);
    routeLogsToTerminal();
    process.exitCode = result.signal ? signalExitCode(result.signal) : result.code ?? 1;
  } catch (error) {
    routeLogsToTerminal();
    logger.error(`Failed to start ${agentCommand}: ${errorMessage(error)}`);
    logger.error(`LLM Lens background log: ${logFile}`);
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

function spawnAgent(
  agentCommand: string,
  agentArgs: string[],
  runtime: InspectorRuntime
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  const child = spawn(agentCommand, agentArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      HTTPS_PROXY: runtime.proxyUrl,
      HTTP_PROXY: runtime.proxyUrl,
      https_proxy: runtime.proxyUrl,
      http_proxy: runtime.proxyUrl,
      NO_PROXY: "localhost,127.0.0.1",
      no_proxy: "localhost,127.0.0.1",
      NODE_EXTRA_CA_CERTS: runtime.caPath,
      SSL_CERT_FILE: runtime.caPath,
      REQUESTS_CA_BUNDLE: runtime.caPath
    },
    shell: process.platform === "win32"
  });

  return new Promise((resolve, reject) => {
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) child.kill(signal);
    };
    process.once("SIGINT", forwardSignal);
    process.once("SIGTERM", forwardSignal);
    child.once("error", (error) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      process.off("SIGINT", forwardSignal);
      process.off("SIGTERM", forwardSignal);
      resolve({ code, signal });
    });
  });
}

async function closeHandles(handles: CloseHandle[]): Promise<void> {
  const errors: unknown[] = [];
  for (const handle of [...handles].reverse()) {
    try {
      await handle.close();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, "Failed to stop LLM Lens cleanly.");
}

function normalizeAgentArgs(agentArgs: string[]): string[] {
  if (agentArgs[0] === "--") return agentArgs.slice(1);
  return agentArgs;
}

function printInspectorStarted(runtime: InspectorRuntime): void {
  console.log("LLM Lens running");
  console.log("");
  console.log(`Proxy: ${runtime.proxyUrl}`);
  console.log(`API/WebSocket: ${runtime.apiBaseUrl}`);
  console.log(`Web UI: ${runtime.uiServerStarted ? runtime.uiUrl : "not served"}`);
  console.log(`CA certificate: ${runtime.caPath}`);
  if (runtime.additionalProviderHosts.length > 0) {
    console.log(`Additional provider hosts: ${runtime.additionalProviderHosts.join(", ")}`);
  }
}

function openBrowserIfUiIsAvailable(runtime: InspectorRuntime): void {
  if (!runtime.uiServerStarted) return;
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", runtime.uiUrl] : [runtime.uiUrl];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return 1;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function envValue(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function envFlag(key: string): boolean {
  const value = process.env[key];
  return value === "1" || value === "true" || value === "yes";
}

function loadEnvFiles(): void {
  const envDir = process.env.INIT_CWD ?? process.cwd();
  dotenv.config({ path: resolve(envDir, ".env.local"), quiet: true });
  dotenv.config({ path: resolve(envDir, ".env"), quiet: true });
}

function readPackageVersion(): string {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

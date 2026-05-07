#!/usr/bin/env node
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { EventStore } from "../server/event-store.js";
import { startInspectorServer, startInspectorUiServer } from "../server/http-server.js";
import { startCaptureProxy } from "../proxy/capture-proxy.js";
import {
  ensureCertificate,
  printCertStatus,
  printInstallInstructions,
  printUninstallInstructions
} from "../cert/cert-cli.js";
import { rootCaPath } from "../cert/paths.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PROXY_PORT = "9191";
const DEFAULT_API_PORT = "9292";
const DEFAULT_UI_PORT = "5270";

dotenv.config({ path: resolve(process.env.INIT_CWD ?? process.cwd(), ".env"), quiet: true });

const program = new Command();

program.name("llm-inspector").description("Local LLM API debugging proxy").version("0.1.0");

program
  .command("start")
  .option("--proxy-port <port>", "proxy port", envValue("LLM_INSPECTOR_PROXY_PORT", DEFAULT_PROXY_PORT))
  .option("--api-port <port>", "API/WebSocket port", envValue("LLM_INSPECTOR_API_PORT", DEFAULT_API_PORT))
  .option("--ui-port <port>", "web UI port used for opening the browser", envValue("LLM_INSPECTOR_UI_PORT", DEFAULT_UI_PORT))
  .option("--host <host>", "bind host", envValue("LLM_INSPECTOR_HOST", DEFAULT_HOST))
  .option("--open", "open the web UI in the default browser")
  .option("--no-ui-server", "do not serve the built web UI")
  .action(async (options: { proxyPort: string; apiPort: string; uiPort: string; host: string; open?: boolean; uiServer: boolean }) => {
    await ensureCertificate();
    const store = new EventStore();
    await startInspectorServer({ host: options.host, port: Number(options.apiPort), store });
    if (options.uiServer) {
      await startInspectorUiServer({
        host: options.host,
        port: Number(options.uiPort),
        apiBaseUrl: `http://${options.host}:${options.apiPort}`,
        proxyUrl: `http://${options.host}:${options.proxyPort}`
      });
    }
    await startCaptureProxy({ host: options.host, port: Number(options.proxyPort), store });

    console.log("LLM Inspector running");
    console.log("");
    console.log(`Proxy: http://${options.host}:${options.proxyPort}`);
    console.log(`API/WebSocket: http://${options.host}:${options.apiPort}`);
    console.log(`Web UI: http://${options.host}:${options.uiPort}`);
    console.log(`CA certificate: ${rootCaPath()}`);
    if (options.open) openBrowser(`http://${options.host}:${options.uiPort}`);
    console.log("");
    console.log("To inspect Node.js agents:");
    console.log(`  export HTTPS_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log(`  export HTTP_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log("  export NO_PROXY=localhost,127.0.0.1");
    console.log(`  export NODE_EXTRA_CA_CERTS="${rootCaPath()}"`);
  });

program
  .command("opencode")
  .description("Start opencode only after LLM Inspector is reachable")
  .argument("[args...]", "arguments passed through to opencode")
  .option("--proxy-port <port>", "proxy port", envValue("LLM_INSPECTOR_PROXY_PORT", DEFAULT_PROXY_PORT))
  .option("--api-port <port>", "API/WebSocket port", envValue("LLM_INSPECTOR_API_PORT", DEFAULT_API_PORT))
  .option("--ui-port <port>", "web UI port opened in the browser", envValue("LLM_INSPECTOR_UI_PORT", DEFAULT_UI_PORT))
  .option("--host <host>", "inspector host", envValue("LLM_INSPECTOR_HOST", DEFAULT_HOST))
  .option("--no-open", "do not open the LLM Inspector UI")
  .allowUnknownOption(true)
  .action(async (args: string[], options: { proxyPort: string; apiPort: string; uiPort: string; host: string; open: boolean }) => {
    const inspector = await ensureInspectorRunning({
      host: options.host,
      proxyPort: Number(options.proxyPort),
      apiPort: Number(options.apiPort),
      uiPort: Number(options.uiPort)
    });
    await quarantineBrokenOpencodeModelsCache();

    const proxyUrl = `http://${options.host}:${options.proxyPort}`;
    const noProxy = mergeNoProxy(process.env.NO_PROXY ?? process.env.no_proxy, ["localhost", "127.0.0.1"]);
    const opencodeCommand = process.env.LLM_INSPECTOR_OPENCODE_BIN ?? "opencode";
    const child = spawn(opencodeCommand, args, {
      stdio: "inherit",
      env: {
        ...process.env,
        HTTPS_PROXY: proxyUrl,
        HTTP_PROXY: proxyUrl,
        NO_PROXY: noProxy,
        https_proxy: proxyUrl,
        http_proxy: proxyUrl,
        no_proxy: noProxy
      }
    });

    if (options.open) openBrowser(`http://${options.host}:${options.uiPort}`);

    child.on("exit", async (code, signal) => {
      if (inspector.started) await inspector.close();
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 1);
    });
    child.on("error", async (error) => {
      if (inspector.started) await inspector.close();
      console.error(`Failed to start opencode: ${error.message}`);
      process.exit(1);
    });
  });

program
  .command("cert")
  .argument("<action>", "generate | install | status | uninstall")
  .action(async (action: string) => {
    if (action === "generate") {
      console.log(await ensureCertificate());
      return;
    }
    if (action === "install") return printInstallInstructions();
    if (action === "status") return printCertStatus();
    if (action === "uninstall") return printUninstallInstructions();
    throw new Error(`Unknown cert action: ${action}`);
  });

await program.parseAsync();

async function isInspectorHealthy(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureInspectorRunning(options: {
  host: string;
  proxyPort: number;
  apiPort: number;
  uiPort: number;
}): Promise<{ started: boolean; close: () => Promise<void> }> {
  if (await isInspectorHealthy(options.host, options.apiPort)) {
    return { started: false, close: async () => undefined };
  }

  await ensureCertificate();
  const store = new EventStore();
  const server = await startInspectorServer({ host: options.host, port: options.apiPort, store });
  const uiServer = await startInspectorUiServer({
    host: options.host,
    port: options.uiPort,
    apiBaseUrl: `http://${options.host}:${options.apiPort}`,
    proxyUrl: `http://${options.host}:${options.proxyPort}`
  });
  const proxy = await startCaptureProxy({ host: options.host, port: options.proxyPort, store });

  console.log(`LLM Inspector API running at http://${options.host}:${options.apiPort}`);
  console.log(`LLM Inspector UI running at http://${options.host}:${options.uiPort}`);
  console.log(`Proxy: http://${options.host}:${options.proxyPort}`);

  return {
    started: true,
    close: async () => {
      proxy.close();
      if (uiServer) await uiServer.close();
      await server.close();
    }
  };
}

async function quarantineBrokenOpencodeModelsCache(): Promise<void> {
  const cachePath = join(homedir(), ".cache", "opencode", "models.json");
  try {
    const prefix = await readFile(cachePath, { encoding: "utf8" });
    if (!prefix.startsWith("HTTP/")) return;
    const target = `${cachePath}.bad-${Date.now()}`;
    await rename(cachePath, target);
    console.warn(`Moved broken opencode models cache to ${target}`);
  } catch {
    // Missing or unreadable cache should not block opencode startup.
  }
}

function mergeNoProxy(current: string | undefined, required: string[]): string {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
  for (const value of required) values.add(value);
  return [...values].join(",");
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

function envValue(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

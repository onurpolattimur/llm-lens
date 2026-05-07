#!/usr/bin/env node
import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Command } from "commander";
import { parseProviderHosts } from "@llm-inspector/shared";
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
const ADDITIONAL_PROVIDER_URLS_ENV = "LLM_INSPECTOR_ADDITIONAL_PROVIDER_URLS";

loadEnvFiles();

const program = new Command();

program.name("llm-inspector").description("Local LLM API debugging proxy").version("0.1.0");

program
  .command("start")
  .option("--proxy-port <port>", "proxy port", envValue("LLM_INSPECTOR_PROXY_PORT", DEFAULT_PROXY_PORT))
  .option("--api-port <port>", "API/WebSocket port", envValue("LLM_INSPECTOR_API_PORT", DEFAULT_API_PORT))
  .option("--ui-port <port>", "web UI port used for opening the browser", envValue("LLM_INSPECTOR_UI_PORT", DEFAULT_UI_PORT))
  .option("--host <host>", "bind host", envValue("LLM_INSPECTOR_HOST", DEFAULT_HOST))
  .option("--additional-provider-urls <urls>", "extra provider hosts or URLs to capture", envValue(ADDITIONAL_PROVIDER_URLS_ENV, ""))
  .option("--open", "open the web UI in the default browser")
  .option("--no-ui-server", "do not serve the built web UI")
  .action(async (options: {
    proxyPort: string;
    apiPort: string;
    uiPort: string;
    host: string;
    additionalProviderUrls: string;
    open?: boolean;
    uiServer: boolean;
  }) => {
    await ensureCertificate();
    const additionalProviderHosts = parseProviderHosts(options.additionalProviderUrls);
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
    await startCaptureProxy({
      host: options.host,
      port: Number(options.proxyPort),
      store,
      additionalProviderHosts
    });

    console.log("LLM Inspector running");
    console.log("");
    console.log(`Proxy: http://${options.host}:${options.proxyPort}`);
    console.log(`API/WebSocket: http://${options.host}:${options.apiPort}`);
    console.log(`Web UI: http://${options.host}:${options.uiPort}`);
    console.log(`CA certificate: ${rootCaPath()}`);
    if (additionalProviderHosts.length > 0) {
      console.log(`Additional provider hosts: ${additionalProviderHosts.join(", ")}`);
    }
    if (options.open) openBrowser(`http://${options.host}:${options.uiPort}`);
    console.log("");
    console.log("To inspect Claude Code / Node.js agents:");
    console.log(`  export HTTPS_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log(`  export HTTP_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log("  export NO_PROXY=localhost,127.0.0.1");
    console.log(`  export NODE_EXTRA_CA_CERTS="${rootCaPath()}"`);
    console.log(`  export SSL_CERT_FILE="${rootCaPath()}"`);
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

function loadEnvFiles(): void {
  const envDir = process.env.INIT_CWD ?? process.cwd();
  dotenv.config({ path: resolve(envDir, ".env.local"), quiet: true });
  dotenv.config({ path: resolve(envDir, ".env"), quiet: true });
}

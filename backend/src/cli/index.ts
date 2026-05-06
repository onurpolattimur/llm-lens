#!/usr/bin/env node
import { Command } from "commander";
import { EventStore } from "../server/event-store.js";
import { startInspectorServer } from "../server/http-server.js";
import { startCaptureProxy } from "../proxy/capture-proxy.js";
import {
  ensureCertificate,
  printCertStatus,
  printInstallInstructions,
  printUninstallInstructions
} from "../cert/cert-cli.js";
import { rootCaPath } from "../cert/paths.js";

const program = new Command();

program.name("llm-inspector").description("Local LLM API debugging proxy").version("0.1.0");

program
  .command("start")
  .option("--proxy-port <port>", "proxy port", "8080")
  .option("--ui-port <port>", "API/WebSocket port", "3000")
  .option("--host <host>", "bind host", "127.0.0.1")
  .action(async (options: { proxyPort: string; uiPort: string; host: string }) => {
    await ensureCertificate();
    const store = new EventStore();
    await startInspectorServer({ host: options.host, port: Number(options.uiPort), store });
    await startCaptureProxy({ host: options.host, port: Number(options.proxyPort), store });

    console.log("LLM Inspector running");
    console.log("");
    console.log(`Proxy: http://${options.host}:${options.proxyPort}`);
    console.log(`API/WebSocket: http://${options.host}:${options.uiPort}`);
    console.log(`CA certificate: ${rootCaPath()}`);
    console.log("");
    console.log("To inspect Node.js agents:");
    console.log(`  export HTTPS_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log(`  export HTTP_PROXY=http://${options.host}:${options.proxyPort}`);
    console.log("  export NO_PROXY=localhost,127.0.0.1");
    console.log(`  export NODE_EXTRA_CA_CERTS="${rootCaPath()}"`);
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


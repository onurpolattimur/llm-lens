import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const captureProxyPath = resolve("backend/dist/proxy/capture-proxy.js");
let source = await readFile(captureProxyPath, "utf8");

source = source
  .replaceAll('"@llm-inspector/shared"', '"../../../shared/dist/index.js"')
  .replaceAll('"@llm-inspector/shared/parser"', '"../../../shared/dist/parser.js"')
  .replaceAll('"@llm-inspector/shared/redaction"', '"../../../shared/dist/redaction.js"');

await writeFile(captureProxyPath, source);

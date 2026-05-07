import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const backendDistDir = resolve("backend/dist");
const sharedDistDir = resolve("shared/dist");
const sharedEntryPoints = {
  "@llm-inspector/shared": "index.js",
  "@llm-inspector/shared/parser": "parser.js",
  "@llm-inspector/shared/redaction": "redaction.js"
};

for (const filePath of await listJavaScriptFiles(backendDistDir)) {
  const originalSource = await readFile(filePath, "utf8");
  let source = originalSource;

  for (const [packageSpecifier, sharedFile] of Object.entries(sharedEntryPoints)) {
    const replacementSpecifier = toModuleSpecifier(relative(dirname(filePath), resolve(sharedDistDir, sharedFile)));
    source = source.replaceAll(`"${packageSpecifier}"`, `"${replacementSpecifier}"`);
  }

  if (source !== originalSource) {
    await writeFile(filePath, source);
  }
}

async function listJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
      if (entry.isFile() && entry.name.endsWith(".js")) return [entryPath];
      return [];
    })
  );
  return files.flat();
}

function toModuleSpecifier(path) {
  const normalizedPath = path.split(sep).join("/");
  return normalizedPath.startsWith(".") ? normalizedPath : `./${normalizedPath}`;
}

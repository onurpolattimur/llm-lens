import os from "node:os";
import path from "node:path";

export function inspectorHome(): string {
  return process.env.LLM_LENS_HOME ?? process.env.LLM_INSPECTOR_HOME ?? path.join(os.homedir(), ".llm-lens");
}

export function certRootDir(): string {
  return path.join(inspectorHome(), "certs");
}

export function rootCaPath(): string {
  return path.join(certRootDir(), "certs", "ca.pem");
}

export function rootCaPrivateKeyPath(): string {
  return path.join(certRootDir(), "keys", "ca.private.key");
}

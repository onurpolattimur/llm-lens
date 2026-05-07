import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { Proxy } from "http-mitm-proxy";
import { certRootDir, rootCaPath, rootCaPrivateKeyPath } from "./paths.js";

export async function ensureCertificate(): Promise<string> {
  if (fs.existsSync(rootCaPath())) return rootCaPath();

  await new Promise<void>((resolve, reject) => {
    const proxy = new Proxy();
    proxy.listen({ host: "127.0.0.1", port: 0, sslCaDir: certRootDir() }, (error?: Error | null) => {
      proxy.close();
      if (error) reject(error);
      else resolve();
    });
  });

  return rootCaPath();
}

export async function printCertStatus(): Promise<void> {
  const certPath = rootCaPath();
  const keyPath = rootCaPrivateKeyPath();
  console.log(`CA certificate: ${fs.existsSync(certPath) ? certPath : "missing"}`);
  console.log(`CA private key: ${fs.existsSync(keyPath) ? keyPath : "missing"}`);
}

export async function installCertificateTrust(): Promise<void> {
  const certPath = await ensureCertificate();
  installSystemTrust(certPath);

  console.log("CA certificate installed into the system trust store.");
  console.log("");
  console.log(`Certificate: ${certPath}`);
  console.log("");
  console.log("For tools that do not use the system trust store, run them with:");
  console.log(`  export NODE_EXTRA_CA_CERTS="${certPath}"`);
  console.log(`  export REQUESTS_CA_BUNDLE="${certPath}"`);
  console.log(`  export SSL_CERT_FILE="${certPath}"`);
}

export async function uninstallCertificateTrust(): Promise<void> {
  const certPath = rootCaPath();
  uninstallSystemTrust(certPath);

  console.log("CA certificate removed from the system trust store.");
  console.log("");
  console.log(`Local certificate files remain at: ${certPath}`);
}

function installSystemTrust(certPath: string): void {
  if (process.platform === "darwin") {
    run("security", withSudo([
      "security",
      "add-trusted-cert",
      "-d",
      "-r",
      "trustRoot",
      "-k",
      "/Library/Keychains/System.keychain",
      certPath
    ]));
    return;
  }

  if (process.platform === "win32") {
    run("certutil", ["-addstore", "-f", "Root", certPath]);
    return;
  }

  if (process.platform === "linux") {
    installLinuxTrust(certPath);
    return;
  }

  throw new Error(`Automatic certificate installation is not supported on ${process.platform}.`);
}

function uninstallSystemTrust(certPath: string): void {
  if (process.platform === "darwin") {
    run("security", withSudo([
      "security",
      "delete-certificate",
      "-c",
      "NodeMITMProxyCA",
      "/Library/Keychains/System.keychain"
    ]));
    return;
  }

  if (process.platform === "win32") {
    run("certutil", ["-delstore", "Root", "NodeMITMProxyCA"]);
    return;
  }

  if (process.platform === "linux") {
    uninstallLinuxTrust(certPath);
    return;
  }

  throw new Error(`Automatic certificate removal is not supported on ${process.platform}.`);
}

function installLinuxTrust(certPath: string): void {
  if (commandExists("update-ca-certificates")) {
    const destination = "/usr/local/share/ca-certificates/llm-lens-ca.crt";
    run("install", withSudo(["install", "-m", "0644", certPath, destination]));
    run("update-ca-certificates", withSudo(["update-ca-certificates"]));
    return;
  }

  if (commandExists("trust") && commandExists("update-ca-trust")) {
    run("trust", withSudo(["trust", "anchor", certPath]));
    run("update-ca-trust", withSudo(["update-ca-trust", "extract"]));
    return;
  }

  throw new Error("Could not find a supported Linux CA tool: update-ca-certificates or trust/update-ca-trust.");
}

function uninstallLinuxTrust(certPath: string): void {
  if (commandExists("update-ca-certificates")) {
    run("rm", withSudo(["rm", "-f", "/usr/local/share/ca-certificates/llm-lens-ca.crt"]));
    run("update-ca-certificates", withSudo(["update-ca-certificates", "--fresh"]));
    return;
  }

  if (commandExists("trust") && commandExists("update-ca-trust")) {
    run("trust", withSudo(["trust", "anchor", "--remove", certPath]));
    run("update-ca-trust", withSudo(["update-ca-trust", "extract"]));
    return;
  }

  throw new Error("Could not find a supported Linux CA tool: update-ca-certificates or trust/update-ca-trust.");
}

function withSudo(command: string[]): string[] {
  if (process.platform === "win32" || process.getuid?.() === 0) return command;
  if (!commandExists("sudo")) throw new Error("sudo is required to update the system trust store.");
  return ["sudo", ...command];
}

function run(commandName: string, command: string[]): void {
  const result = spawnSync(command[0], command.slice(1), { stdio: "inherit" });
  if (result.error) {
    throw new Error(`Failed to run ${commandName}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${commandName} exited with status ${result.status ?? "unknown"}.`);
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], { stdio: "ignore" });
  return result.status === 0;
}

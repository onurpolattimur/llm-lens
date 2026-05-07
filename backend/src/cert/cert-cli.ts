import fs from "node:fs";
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

export async function printInstallInstructions(): Promise<void> {
  const certPath = await ensureCertificate();
  console.log("CA certificate generated.");
  console.log("");
  console.log(`Certificate: ${certPath}`);
  console.log("");
  console.log("macOS system trust:");
  console.log(`  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${certPath}"`);
  console.log("");
  console.log("Node.js process trust:");
  console.log(`  export NODE_EXTRA_CA_CERTS="${certPath}"`);
  console.log("");
  console.log("Python requests trust:");
  console.log(`  export REQUESTS_CA_BUNDLE="${certPath}"`);
  console.log(`  export SSL_CERT_FILE="${certPath}"`);
}

export async function printUninstallInstructions(): Promise<void> {
  const certPath = rootCaPath();
  console.log("Remove trust manually from Keychain Access, or on macOS run:");
  console.log(`  sudo security delete-certificate -c "NodeMITMProxyCA" /Library/Keychains/System.keychain`);
  console.log("");
  console.log(`Local certificate files remain at: ${certPath}`);
}

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PROXY_PORT = "9191";
const DEFAULT_API_PORT = "9292";
const DEFAULT_UI_PORT = 5270;

export default defineConfig(({ mode }) => {
  const envDir = process.env.INIT_CWD || process.cwd();
  const env = loadEnv(mode, envDir, "");
  const host = env.LLM_LENS_HOST || DEFAULT_HOST;
  const apiPort = env.LLM_LENS_API_PORT || DEFAULT_API_PORT;
  const proxyPort = env.LLM_LENS_PROXY_PORT || DEFAULT_PROXY_PORT;
  const uiPort = Number(env.LLM_LENS_UI_PORT || DEFAULT_UI_PORT);

  return {
    plugins: [react()],
    envPrefix: ["VITE_", "LLM_LENS_"],
    server: {
      host,
      port: uiPort,
      open: true
    },
    preview: {
      host,
      port: uiPort
    },
    define: {
      "import.meta.env.VITE_LENS_API": JSON.stringify(env.VITE_LENS_API || `http://${host}:${apiPort}`),
      "import.meta.env.VITE_LENS_PROXY_URL": JSON.stringify(`http://${host}:${proxyPort}`)
    }
  };
});

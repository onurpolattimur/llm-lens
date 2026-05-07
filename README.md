# LLM Inspector

Local LLM API debugging proxy for inspecting provider requests and responses.

## Development

```sh
npm install
npm run dev
```

Open the UI automatically while developing. Dev commands run TypeScript source
directly and do not require rebuilding `shared` first:

```sh
npm run dev:open
```

Default endpoints:

- Web UI: `http://127.0.0.1:5270`
- API/WebSocket: `http://127.0.0.1:9292`
- Proxy: `http://127.0.0.1:9191`

Ports can be configured from `.env.local` or `.env`:

```sh
LLM_INSPECTOR_PROXY_PORT=9191
LLM_INSPECTOR_API_PORT=9292
LLM_INSPECTOR_UI_PORT=5270
LLM_INSPECTOR_HOST=127.0.0.1
LLM_INSPECTOR_ADDITIONAL_PROVIDER_URLS=api.netiva.com.tr
```

`LLM_INSPECTOR_ADDITIONAL_PROVIDER_URLS` accepts comma or whitespace separated
hosts/URLs. Matching requests are captured even when the provider is not one of
the built-in hosts.

CLI flags override `.env` values:

```sh
npx llm-inspector start --proxy-port 9191 --api-port 9292 --ui-port 5270
npx llm-inspector start --additional-provider-urls api.netiva.com.tr
```

## Inspect Claude Code / Node.js Agents

```sh
export HTTPS_PROXY=http://127.0.0.1:9191
export HTTP_PROXY=http://127.0.0.1:9191
export NO_PROXY=localhost,127.0.0.1
export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/certs/ca.pem"
export SSL_CERT_FILE="$HOME/.llm-inspector/certs/certs/ca.pem"
```

Claude Code does not support `NO_PROXY`; keep it for other tools in the same
shell, but do not rely on it for Claude Code proxy bypass behavior.

You can also start only the inspector:

```sh
npx llm-inspector start --open
```

For local development without publishing first, build once and use the local
package path from another directory:

```sh
npm run build
npx /path/to/llm-inspector start --open
```

## Certificate Commands

```sh
npm run build
node backend/dist/cli/index.js cert status
node backend/dist/cli/index.js cert install
node backend/dist/cli/index.js cert uninstall
```

The `cert install` command prints the platform/runtime commands to trust the local CA. It does not run `sudo`.

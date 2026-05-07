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

Ports can be configured from `.env`:

```sh
LLM_INSPECTOR_PROXY_PORT=9191
LLM_INSPECTOR_API_PORT=9292
LLM_INSPECTOR_UI_PORT=5270
LLM_INSPECTOR_HOST=127.0.0.1
```

CLI flags override `.env` values:

```sh
npx llm-inspector start --proxy-port 9191 --api-port 9292 --ui-port 5270
npx llm-inspector opencode --proxy-port 9191 --api-port 9292 --ui-port 5270
```

## Inspect A Node.js Agent

```sh
export HTTPS_PROXY=http://127.0.0.1:9191
export HTTP_PROXY=http://127.0.0.1:9191
export NO_PROXY=localhost,127.0.0.1
export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/certs/ca.pem"
```

## Inspect opencode

opencode is packaged with Bun, so `NODE_EXTRA_CA_CERTS` may not be enough. Trust the LLM Inspector CA in macOS:

```sh
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.llm-inspector/certs/certs/ca.pem"
```

Then start opencode through LLM Inspector:

```sh
npx llm-inspector opencode
```

The command can be run from any project directory. If LLM Inspector is not
already running, it starts the web UI and proxy first, waits for the healthcheck,
opens the browser, then launches `opencode` in the original current directory
with the proxy environment variables set.

If opencode previously cached a broken `models.json` response from a dead proxy,
the wrapper moves that file aside before startup.

You can also start only the inspector:

```sh
npx llm-inspector start --open
```

For local development without publishing first, build once and use the local
package path from another directory:

```sh
npm run build
npx /path/to/llm-inspector opencode
```

## Certificate Commands

```sh
npm run build
node backend/dist/cli/index.js cert status
node backend/dist/cli/index.js cert install
node backend/dist/cli/index.js cert uninstall
```

The `cert install` command prints the platform/runtime commands to trust the local CA. It does not run `sudo`.

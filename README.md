# LLM Inspector

Local LLM API debugging proxy for inspecting provider requests and responses.

## Development

```sh
npm install
npm run dev
```

Default endpoints:

- Web UI: `http://127.0.0.1:5173`
- API/WebSocket: `http://127.0.0.1:3000`
- Proxy: `http://127.0.0.1:8080`

## Inspect A Node.js Agent

```sh
export HTTPS_PROXY=http://127.0.0.1:8080
export HTTP_PROXY=http://127.0.0.1:8080
export NO_PROXY=localhost,127.0.0.1
export NODE_EXTRA_CA_CERTS="$HOME/.llm-inspector/certs/certs/ca.pem"
```

## Inspect opencode

opencode is packaged with Bun, so `NODE_EXTRA_CA_CERTS` may not be enough. Trust the LLM Inspector CA in macOS:

```sh
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.llm-inspector/certs/certs/ca.pem"
```

Then start opencode with the proxy variables:

```sh
HTTPS_PROXY=http://127.0.0.1:8080 \
HTTP_PROXY=http://127.0.0.1:8080 \
NO_PROXY=localhost,127.0.0.1 \
opencode
```

## Certificate Commands

```sh
npm run build
node backend/dist/cli/index.js cert status
node backend/dist/cli/index.js cert install
node backend/dist/cli/index.js cert uninstall
```

The `cert install` command prints the platform/runtime commands to trust the local CA. It does not run `sudo`.

# Use the locally installed Codex CLI

Dossier can use your existing Codex ChatGPT login through a small host bridge. The Docker container sends its usual OpenAI-compatible requests to the bridge, which runs `codex exec`. No OpenAI API key is needed. Inference still runs on OpenAI's servers and uses your Codex account limits.

The address examples below target Docker Desktop on Linux, with Codex installed on the same computer. The bridge binds only to `127.0.0.1`; it is not a public service. Docker Desktop on Linux can reach that loopback listener through `host.docker.internal`. For Docker Engine on Linux or inside Windows WSL2, first follow the [installation guide](installation.md), including its host-network overlay, and use `http://127.0.0.1:8787/v1` instead. On Windows, run the bridge and Codex inside WSL2; native PowerShell execution of this bridge is not supported by these instructions.

## Start the bridge

Use Node.js 22 or later **on the host**, rather than inside Dossier's container. The bridge has no npm dependencies. Run it as the user who signed in to Codex:

```bash
codex login status
# If necessary: codex login, then sign in with ChatGPT.
```

Create `~/.config/dossier-codex-bridge.env` with permissions `600`. It must contain:

```dotenv
DOSSIER_CODEX_BRIDGE_TOKEN=REPLACE_WITH_A_RANDOM_LOCAL_TOKEN
DOSSIER_CODEX_BIN=/absolute/path/to/codex
DOSSIER_CODEX_BRIDGE_SCRIPT=/absolute/path/to/dossier/scripts/codex-bridge.mjs
PATH=/directory/containing/node:/usr/local/bin:/usr/bin:/bin
```

Generate the token with `openssl rand -hex 32`. Use `command -v codex` and `command -v node` to find the paths. The token protects access to your Codex session. It is a local shared secret, not an OpenAI API key. Keep it out of Git and do not reuse an API key as this token.

From the repository root, start in the foreground:

```bash
node --env-file="$HOME/.config/dossier-codex-bridge.env" scripts/codex-bridge.mjs
```

The bridge checks that Codex is signed in with ChatGPT and loads its model catalog before listening. Its default address is `http://127.0.0.1:8787/v1` and its timeout is 300 seconds. `DOSSIER_CODEX_BRIDGE_PORT` and `DOSSIER_CODEX_TIMEOUT_SECONDS` override the port and timeout. Models and thinking levels are selected in Dossier; `DOSSIER_CODEX_MODEL` from older configurations no longer fixes the request model.

For persistent operation, copy the supplied user service:

```bash
mkdir -p "$HOME/.config/systemd/user"
cp scripts/dossier-codex-bridge.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now dossier-codex-bridge.service
journalctl --user -u dossier-codex-bridge.service -n 20 --no-pager
```

The service starts with your user session. Running it before login or after logout requires user lingering, configured separately through `loginctl`. Use either the foreground process or the service; both use the same port.

## Connect Dossier

In **Settings → AI provider**, select **OpenAI-compatible** and enter:

| Field | Value |
| --- | --- |
| Server address | `http://host.docker.internal:8787/v1` |
| Model | Select a model from the Codex catalog, e.g. `gpt-6.1-sol` |
| Thinking effort | Select a supported level; the existing setup starts at Medium |
| API key | The **local bridge token** from the host environment file |

The existing API key field is used for the bridge token. Dossier stores it encrypted. Selecting another provider clears its previous saved key, as it normally does.

Set `DOSSIER_AI_TIMEOUT_SECONDS=300` in your deployment's `.env` and recreate the app container to apply that environment change:

Use the same production Compose files as installation. The installation guide sets `COMPOSE_FILE` in `.env`, so the following command selects them automatically. Without that setting, pass the matching `-f` options explicitly; the repository's default Compose file is for development.

```bash
docker compose up -d --no-deps app
```

Press **Test connection**, then try a sample posting. You can also set `DOSSIER_AI_PROVIDER=openai`, `DOSSIER_AI_URL`, `DOSSIER_AI_MODEL`, and `DOSSIER_AI_KEY` in the deployment environment before saving a provider in Settings. A saved provider takes precedence over environment defaults.

The production Compose file already supplies the `host.docker.internal` mapping. The model/thinking controls and Codex-specific error messages require an application image built from this revision. No database migration is needed: the thinking selection uses Dossier's existing settings table.

## Supported behavior

- `GET /v1/models` advertises Codex's picker-visible models, display names, and supported reasoning efforts. The bridge loads the catalog through `codex app-server` and `model/list` at startup; restart the bridge to refresh it. The catalog is not an account entitlement check.
- Model and Thinking effort save automatically. The selected effort is sent as `reasoning_effort` and applies to all AI tasks, including connection checks and extraction. Choosing a model that does not support the previous effort selects that model's default in the form before saving. Unsupported combinations sent directly to the bridge are rejected, not substituted. Requests that omit effort retain the previous Medium setting.
- `POST /v1/chat/completions` accepts ordered text messages with `system`, `user`, and `assistant` roles. Each call is a new ephemeral Codex session; Dossier supplies conversation history.
- JSON schemas are passed through `--output-schema`. Dossier retains its existing validation and single correction attempt.
- `temperature` is accepted but not forwarded: Codex has no equivalent CLI setting. Dossier's prompts retain their writing-style instructions.
- `max_tokens` and `max_completion_tokens` are approximate length instructions, not hard token caps. Answers are never truncated by the bridge.
- Streaming, tool calls, images, and other API parameters are rejected. This is a Dossier adapter, not a general OpenAI API proxy.
- Three requests can run concurrently. Additional requests receive a busy error. The bridge adds no retries or provider fallback and tells the SDK not to retry failed bridge requests automatically.
- Timeout, disconnection, and service shutdown terminate the CLI process group. Private temporary schema files are removed afterward. Requests are limited to 2 MiB and CLI output to 8 MiB.
- Codex runs with a read-only sandbox, shell/image tools, apps, and web search disabled, without user configuration or repository instructions. API keys, the bridge token, database credentials, and parent CLI session variables are not inherited. Prompts and raw CLI output are not logged. Codex may update its own authentication and runtime state on the host.

If login expires, run `codex login` on the host and restart the service. Check service logs for quota, executable, model, or connectivity errors. Changing the bridge token requires updating Dossier's saved token too.

## Tests

Run the dependency-free bridge tests on the host:

```bash
node --test scripts/codex-bridge.test.mjs
```

They use a stub executable and temporary localhost ports, not your Codex account. The opt-in live tests use synthetic profile data and consume account quota:

```bash
docker compose run --rm --no-deps \
  -e AI_LIVE=codex \
  -e CODEX_BRIDGE_URL=http://host.docker.internal:8787/v1 \
  -e CODEX_BRIDGE_TEST_TOKEN \
  app yarn vitest run --project node src/lib/ai/codex-bridge.live.test.ts
```

Export `CODEX_BRIDGE_TEST_TOKEN` on the host first. Use a development container built from this checkout with its Prisma client generated. The live tests do not create applications, change settings, or send email.

See the official [noninteractive Codex documentation](https://learn.chatgpt.com/docs/non-interactive-mode) and [authentication documentation](https://learn.chatgpt.com/docs/auth).

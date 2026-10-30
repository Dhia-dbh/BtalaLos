# Containerized application preparation

The preparation worker now has its own image. It supplies Git, `latexmk`, pdfLaTeX, XeLaTeX, LuaLaTeX, Poppler, Python, and pinned PyMuPDF. Your computer only runs Docker, Node.js, and the authenticated coding CLI. The Linux folder button additionally needs `gdbus` in a desktop session.

The web app and PostgreSQL remain separate containers. A small **host companion** handles CLI model discovery, generation, and folder opening. Coding CLI credentials stay on the host; neither credentials nor coding CLIs are installed in the worker image. The existing Codex OpenAI-compatible bridge remains separate and optional for native AI tasks.

## TeX package selection

The image installs `texlive-latex-base`, `texlive-latex-recommended`, `texlive-latex-extra`, `texlive-fonts-recommended`, `texlive-xetex`, and `texlive-luatex`, without recommended extras or offline documentation. It does **not** install `texlive-full`. This follows the revised requirement to include compilation runtimes rather than the full collection.

These packages support the existing three engines and common templates. They do not guarantee every custom template, language, or proprietary font. Add missing Debian packages explicitly through `DOSSIER_TEX_EXTRA_PACKAGES` and rebuild; no runtime package downloads or alternate compiler fallback are added.

All engines disable shell escape. Container LuaLaTeX uses `--nosocket` rather than the old `--safer` flag, which is incompatible with its standard OpenType font loader. It also permits absolute input paths for that loader's Unicode/font data while retaining TeX's output-path restrictions. It runs inside the non-root, read-only container with only the configured directories mounted. LaTeX projects must be trusted: mounted repository, worktree, and export files are accessible to the compiler. The all-host deployment retains its previous Lua `--safer` and input settings and their limitations.

Python uses the existing pinned `requirements.txt` and a build-time virtual environment. Poetry is not used. The image requires no npm/Yarn installation.

## 1. Prerequisites and directories

Install Docker and Node.js using the [installation guide](installation.md). On Windows use its **Docker Engine inside Ubuntu WSL2** route and run the host companion in the same Ubuntu distribution. Native Windows execution is not implemented. Docker Desktop on Linux is also supported by the configuration below.

Use an authenticated Linux Codex or Claude Code installation. Only Codex is tested with a live account; automated Claude tests use fixtures. No host LaTeX, Python, or Poppler installation is required for this route.

From the BtalaLos checkout, prepare three directories, owned by your ordinary user:

```sh
mkdir -p "$HOME/latex-projects" "$HOME/.local/share/btalalos-worker" "$HOME/application-packages"
realpath "$HOME/latex-projects" "$HOME/.local/share/btalalos-worker" "$HOME/application-packages"
id -u
id -g
```

Put or clone the external LaTeX Git project under the first directory. The other two hold worker data/worktrees and exported packages. Keep them outside the BtalaLos source tree. The repository picker can only browse the configured shared repository root.

Use the **canonical absolute paths printed by `realpath`** in the following configuration. Each directory is mounted at that same path inside Docker; this is required for Git worktrees to remain usable from host editors. Do not use symlink aliases, Windows drive-letter paths, or mount the repository at a different container path.

## 2. Configure Compose

Keep the web app's password, secret, database password, and image settings from the [basic installation](installation.md#2-build-and-start-the-web-app). Add these entries to the app's `.env`, replacing paths, UID/GID, and tokens with your actual values:

```dotenv
COMPOSE_FILE=compose.production.yml:compose.preparation.yml
DOSSIER_IMAGE=btalalos:local
DOSSIER_WORKER_IMAGE=btalalos-worker:local
DOSSIER_WORKER_REPOSITORY_ROOT=/home/YOUR_USER/latex-projects
DOSSIER_WORKER_DATA_DIR=/home/YOUR_USER/.local/share/btalalos-worker
DOSSIER_WORKER_EXPORT_DIR=/home/YOUR_USER/application-packages
DOSSIER_WORKER_UID=1000
DOSSIER_WORKER_GID=1000
DOSSIER_WORKER_TOKEN=REPLACE_WITH_A_RANDOM_WORKER_TOKEN
DOSSIER_HOST_TOKEN=REPLACE_WITH_A_DIFFERENT_RANDOM_HOST_TOKEN
```

Generate each token separately with `openssl rand -hex 32`. The worker and host-companion tokens are local shared secrets, not cloud API keys. The Compose overlay configures `DOSSIER_WORKER_URL` automatically. Do not combine this overlay with the development `compose.yml`.

### Docker Desktop on Linux

Use the `COMPOSE_FILE` value above. The app reaches `http://worker:8788` through Compose networking, and the worker reaches the host companion at `http://host.docker.internal:8789`. The worker has no published host port.

### Native Docker Engine on Linux or inside WSL2

Change the same `.env` entry to:

```dotenv
COMPOSE_FILE=compose.production.yml:compose.preparation.yml:compose.preparation.host.yml
```

This override puts the app and worker on the host network, with both bound to loopback. The worker reaches the companion at `http://127.0.0.1:8789`; the app reaches the worker at `http://127.0.0.1:8788`. PostgreSQL is published only on loopback port 55432. The app's database URL is overridden accordingly. This does not use the earlier manually created `compose.host-local.yml`.

Use current Compose v2 with `!reset` support. Ports 3000, 55432, 8788, and 8789 must be available; the separate Codex bridge uses 8787 if enabled. `DOSSIER_PORT` and `DOSSIER_DB_PORT` can change the app/database ports. This configuration is for rootful Engine, not rootless networking.

## 3. Start the host companion

Create a private receipt directory and environment file outside Git:

```sh
mkdir -p "$HOME/.config" "$HOME/.local/share/btalalos-host"
touch "$HOME/.config/btalalos-application-host.env"
chmod 600 "$HOME/.config/btalalos-application-host.env"
command -v node
command -v codex
```

Edit `~/.config/btalalos-application-host.env`:

```dotenv
DOSSIER_HOST_TOKEN=THE_SAME_HOST_TOKEN_AS_COMPOSE
DOSSIER_HOST_DATA_DIR=/home/YOUR_USER/.local/share/btalalos-host
DOSSIER_WORKER_EXPORT_DIR=/home/YOUR_USER/application-packages
DOSSIER_HOST_SCRIPT=/absolute/path/to/BtalaLos/scripts/application-host.mjs
DOSSIER_CODEX_BIN=/absolute/path/to/codex
# Set this only when using Claude Code:
# DOSSIER_CLAUDE_BIN=/absolute/path/to/claude
PATH=/directory/containing/node:/usr/local/bin:/usr/bin:/bin
```

Use actual executable paths and the same export directory as the container. This receipt directory is separate from the worker's data directory. Run under the account signed into the chosen CLI; do not use `sudo` for the companion.

Start in the foreground from the BtalaLos root:

```sh
node --env-file="$HOME/.config/btalalos-application-host.env" scripts/application-host.mjs
```

It listens only on `127.0.0.1:8789`. Its allowed operations are CLI discovery, structured generation, and verified export reveal. It cannot accept Git edits, compilation, arbitrary file export, or arbitrary shell commands. Authentication and selected CLI tools remain host-side.

After foreground use works, the optional user service is:

```sh
mkdir -p "$HOME/.config/systemd/user"
cp scripts/btalalos-application-host.service "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now btalalos-application-host.service
```

Use either the foreground process or service. The service needs the correct script path and `PATH` in its environment file. It starts with your Linux user session, not automatically with Windows boot.

## 4. Build and run

In another terminal at the checkout root:

```sh
docker compose config --quiet
docker compose build app worker
docker compose up -d
docker compose ps
docker compose logs --tail=80 worker
```

The first build downloads TeX and PyMuPDF. Later source-only worker changes reuse the tools layer. The overlay uses local image tags with `pull_policy: never`; build them before starting. Image publication to a registry is not part of this change.

Open the application, configure **Settings → LaTeX project** and **Job profiles and bundles**, and choose the repository from the shared root. Prepare a sample application and inspect the PDFs and source changes. One-page checks, stage history, source hashes, per-application branches, local email drafts, portal handling, and merge-only regeneration retain their existing behavior.

The worker health check validates the HTTP service without requiring CLI login. If the companion is stopped, compilation, PDF reading, and merging remain available; CLI and folder operations report the missing companion rather than selecting a local CLI.

### Template-specific packages and fonts

For example, a template needing French language support can set:

```dotenv
DOSSIER_TEX_EXTRA_PACKAGES=texlive-lang-french
```

Then run `docker compose build worker` followed by `docker compose up -d worker`. Changing this variable without rebuilding does not install packages. `DOSSIER_WORKER_MEMORY` can raise the default 2 GiB upper limit for unusually demanding templates; it is not reserved memory.

Custom system fonts can be shared through an additional local Compose override:

```yaml
services:
  worker:
    volumes:
      - type: bind
        source: /absolute/path/to/your-fonts
        target: /usr/local/share/fonts/custom
        read_only: true
        bind:
          create_host_path: false
```

Append that override to `COMPOSE_FILE` and recreate the worker. Supply fonts you have permission to use. The host's TeX installation is never mounted or silently consulted.

## Existing installations and local files

Stop the old host worker before starting this container against the same data directory. For a user service, use `systemctl --user stop dossier-application-worker.service`; for foreground execution, use Ctrl+C. Retain its canonical data/export/repository paths in the mounts if reusing worktrees.

Do not run the old worker and container simultaneously against the same receipts or worktrees. Existing paths must remain accessible inside the container. Source/repository checks reject incompatible worktrees; there is no automatic Git metadata rewrite or directory migration. The all-host worker remains available as an explicitly selected alternative in [Application preparation](application-preparation.md).

The folder button exports in the container, then asks the host companion to reveal the existing, checksum-matched PDF under the configured export directory. It never forwards an arbitrary host path. Linux requires `gdbus` and a desktop session. WSL continues to use downloads; Windows Explorer integration is not implemented.

Back up the app plus the external Git repositories, worker data, host receipts, and exported files separately. Container recreation preserves bind-mounted files and history. Temporary operation PDF copies are removed after success or failure; durable receipts and archived packages remain.

## Verification

The dependency-free host/worker regression tests use fixture CLIs:

```sh
node --test scripts/application-host.test.mjs
```

To run the opt-in container integration test against the built image on Docker Desktop on Linux:

```sh
WORKER_CONTAINER_TEST=1 node --test scripts/worker-container.test.mjs
```

For native Docker Engine, add `WORKER_TEST_NETWORK=host` to that command. The test uses temporary repositories under the Git-ignored `data/worker-container-tests` directory, synthetic host CLI fixtures, and disposable containers. This keeps its bind mounts inside the project path already shared with Docker Desktop. It checks all three TeX engines, PDF order/links, persistent worktrees, host editing, and receipt replay after container recreation. It requires host Node, Git, and Docker, but no host Python/TeX/Poppler. It does not consume provider quota or send email.

The full historical host-worker tests still need their original host tools. See [the worker efficiency review](worker-efficiency.md) for image design, configuration checks, and current validation results.

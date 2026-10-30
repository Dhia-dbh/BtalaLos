# Install BtalaLos on Linux or Windows

This guide installs the current source, not the original Dossier image. The web app runs in Docker and opens in your browser. The optional host services add Codex access and LaTeX application preparation.

For LaTeX and PDF packages, use the [containerized worker guide](container-worker.md) after steps 1–2 below. It bundles the TeX/Python/PDF tools and keeps only Node.js and CLI authentication on the host. The later host-tool installation instructions are the explicitly selectable all-host alternative.

## Choose the features you need

| Feature | What you install on the computer |
| --- | --- |
| Web app with native document editing and a hosted AI API | Git, Docker Engine or Docker Desktop, and Docker Compose |
| Native AI tasks through an existing Codex account | The above, plus Node.js 24 and the Codex CLI; run the HTTP bridge |
| Existing LaTeX projects and merged PDF packages | Recommended: Docker plus host Node.js 24 and the selected CLI, using the [worker image](container-worker.md). All-host alternative: also install Git, TeX, Poppler, Python/PyMuPDF |
| Desktop folder opening | A Linux desktop session with `gdbus`; optional, PDF download works without it |

PostgreSQL, the app's Node.js runtime, Yarn dependencies, Chromium, and native-document fonts are already supplied by Docker. Do not install them separately on the host. LaTeX and PDF-merging tools are supplied by the **separate worker image**, not the web image. Even native-document package merging needs the worker.

The commands below target **Ubuntu 24.04 LTS**, either directly on Linux or inside **WSL2 on Windows**. Other Linux distributions need equivalent packages. Native Windows execution of the host services is not supported by this guide: they use Unix process groups and Linux tools. Only Codex has been tested with a live account; Claude Code remains unverified live.

## 1. Prepare the operating system

### Linux

Use a terminal on your Ubuntu computer. Install the basic tools:

```sh
sudo apt update
sudo apt install git curl ca-certificates openssl
```

Install Docker Engine and its Compose plugin using Docker's [Ubuntu installation instructions](https://docs.docker.com/engine/install/ubuntu/), specifically the official apt repository method. Follow its instructions about conflicting packages if Docker is already installed. Start and verify the service:

```sh
sudo systemctl enable --now docker
sudo docker run --rm hello-world
```

To use the commands below without `sudo`, follow Docker's [Linux post-installation instructions](https://docs.docker.com/engine/install/linux-postinstall/). Docker group membership grants root-level privileges. Sign out and back in after changing membership, then verify:

```sh
docker version
docker compose version
```

Already using Docker Desktop on Linux? Keep that installation. Basic web installation below works with either engine; host-service networking has separate instructions in step 4. Do not switch Docker contexts expecting existing volumes to move between engines.

### Windows: use WSL2

In **PowerShell as Administrator**, install Ubuntu:

```powershell
wsl --install -d Ubuntu-24.04
```

Restart Windows if requested. Open **Ubuntu 24.04** from the Start menu and create its Linux username and password. Check the distribution in PowerShell:

```powershell
wsl --list --verbose
```

It must show version **2**. See Microsoft's [WSL installation guide](https://learn.microsoft.com/en-us/windows/wsl/install) if installation or virtualization setup is needed.

For the full LaTeX workflow, this guide uses **Docker Engine inside that Ubuntu distribution**. Complete the Linux instructions above inside Ubuntu. Do not combine this daemon with Docker Desktop's WSL integration for the same distribution. If Docker Desktop is already installed, disable integration for this Ubuntu distribution before using the Engine route. Docker explains its separate Desktop route in [WSL integration](https://docs.docker.com/desktop/features/wsl/).

Docker Engine needs systemd for the service commands above. Check in Ubuntu:

```sh
ps -p 1 -o comm=
```

If it is not `systemd`, follow Microsoft's [WSL systemd instructions](https://learn.microsoft.com/en-us/windows/wsl/systemd/): edit `/etc/wsl.conf`, preserving existing settings, and add or update:

```ini
[boot]
systemd=true
```

Save work in all WSL sessions, run `wsl --shutdown` in PowerShell, then reopen Ubuntu. This stops running WSL services as well as terminals.

**All subsequent shell commands run in Ubuntu, not PowerShell or Git Bash.** Install Node, Python, TeX, and coding CLIs inside Ubuntu too. A Windows installation of a tool does not supply its Linux counterpart.

## 2. Build and start the web app

Clone into your Linux home directory. On Windows this means WSL's Linux filesystem, rather than `/mnt/c`:

```sh
mkdir -p "$HOME/projects"
cd "$HOME/projects"
git clone https://github.com/Dhia-dbh/BtalaLos.git
cd BtalaLos
docker build --target production -t btalalos:local .
```

The build downloads application dependencies and Chromium. Allow time and disk space for the build cache and database. The full LaTeX installation below needs additional space; it is not part of this image.

For a new installation, create the environment file (keep an existing `.env` when upgrading):

```sh
cp .env.example .env
docker run --rm -it btalalos:local hash-password
openssl rand -hex 24
openssl rand -base64 32
```

The last three commands produce, respectively, the app password hash, a database password, and the session/encryption secret. Edit `.env` and set these values:

```dotenv
COMPOSE_FILE=compose.production.yml
DOSSIER_IMAGE=btalalos:local
POSTGRES_PASSWORD=PASTE_THE_GENERATED_HEX_DATABASE_PASSWORD
DOSSIER_PASSWORD=PASTE_THE_GENERATED_PASSWORD_HASH
DOSSIER_SECRET=PASTE_THE_GENERATED_SESSION_SECRET
DOSSIER_TELEMETRY=off
```

`COMPOSE_FILE` ensures that `docker compose` uses production settings instead of the repository's development Compose file. Keep these names: the fork still reads `DOSSIER_*` configuration. The example's host `DATABASE_URL` is for development tooling; production Compose supplies the app's database URL.

Protect the file and start the app:

```sh
chmod 600 .env
docker compose up -d
docker compose ps
docker compose logs --tail=80 app
```

Open **http://localhost:3000** in your Linux or Windows browser and sign in with the password you hashed. Windows normally forwards WSL application ports to localhost; see Microsoft's [WSL networking guide](https://learn.microsoft.com/en-us/windows/wsl/networking) if that forwarding is restricted on your computer.

This is sufficient for native documents using a hosted AI provider configured in **Settings → AI provider**. Gmail is optional. Skip the following host-service steps if you do not need CLI access or document packages.

## 3. Install optional host tools

For the recommended worker image, install Node.js and the coding CLI below, then continue with [container setup](container-worker.md). Skip the host TeX/Python section and the host-worker networking instructions in this document.

### Node.js and the coding CLI

Install **Node.js 24** for Linux using the [official Node.js download instructions](https://nodejs.org/en/download). Use the Linux instructions inside WSL as well. Verify in the terminal that will run the services:

```sh
node --version
npm --version
```

The first command should print `v24.x.x`. The host services support Node 22 or later; using 24 also matches the app image. Ubuntu's default `nodejs` package may not provide this version.

Install Codex using its [official CLI instructions](https://learn.chatgpt.com/docs/cli), then sign in **as your ordinary Linux/WSL user**, not root:

```sh
codex login
codex login status
command -v node
command -v codex
```

Use ChatGPT authentication for this bridge. The CLI must support the flags and model-catalog operations described in [the bridge guide](codex-cli.md). Keep the executable paths for the environment files below. Do not use a Windows `codex.exe` from WSL.

For Claude Code preparation instead, install and authenticate the Linux CLI using [Anthropic's setup instructions](https://code.claude.com/docs/en/setup). Only the chosen CLI is required. The HTTP bridge supports Codex only; Claude's adapter belongs to the preparation worker.

### LaTeX and PDF tools: worker only

Skip this section if you only need the Codex HTTP bridge. On Ubuntu, including WSL:

```sh
sudo apt update
sudo apt install latexmk texlive-latex-base texlive-latex-recommended texlive-latex-extra texlive-fonts-recommended texlive-xetex texlive-luatex poppler-utils python3 python3-venv
python3 -m venv "$HOME/.local/share/dossier-worker-python"
"$HOME/.local/share/dossier-worker-python/bin/pip" install -r scripts/application-worker/requirements.txt
```

`latexmk` orchestrates compilation; it does not replace a TeX distribution. The packages above are a starting set. Install the language packages, fonts, and other TeX packages required by **your** project. `texlive-full` is an optional, much larger installation when a broad TeX collection is preferred. Neither choice guarantees proprietary fonts or external assets used by a template.

Verify the tools:

```sh
git --version
latexmk -v
pdflatex --version
xelatex --version
lualatex --version
pdfinfo -v
pdftotext -v
"$HOME/.local/share/dossier-worker-python/bin/python" -c 'import pymupdf; print(pymupdf.__version__)'
```

Keep the LaTeX project in its own Git repository, separate from the BtalaLos checkout. For WSL, clone it under `$HOME/projects` and select its Linux path in Settings. Commit the base CV, letter, and required assets before preparation. Compile the two entrypoints manually with your chosen engine first to identify missing template dependencies. Generated documents must each fit one page.

For the optional folder button on a Linux desktop, install `libglib2.0-bin`, which supplies `gdbus`, and run the worker in that desktop user's session. WSL users should use PDF downloads; installing `gdbus` alone does not implement Windows Explorer integration.

## 4. Connect containers to loopback host services

Both host services listen on **127.0.0.1**, not the LAN. A `host.docker.internal` mapping by itself does not make host loopback reachable from a Docker Engine bridge network.

### Docker Engine on Linux or inside WSL

Use this explicit local host-network setup. Create `compose.host-local.yml` beside `compose.production.yml`:

```yaml
services:
  db:
    ports:
      - "127.0.0.1:55432:5432"
  app:
    network_mode: host
    ports: !reset []
    environment:
      HOSTNAME: "127.0.0.1"
      DATABASE_URL: postgresql://dossier:${POSTGRES_PASSWORD}@127.0.0.1:55432/dossier
```

Use a current Docker Compose v2 plugin with `!reset` support; this example was parsed with Compose 2.39.4. The app shares the host network so it can reach the two private listeners. PostgreSQL is published only on loopback port 55432. Database service-name DNS is unavailable to the host-network app, so its URL is overridden too. Ports 3000, 55432, 8787, and 8788 must be free for the features using them. See Docker's [host networking](https://docs.docker.com/engine/network/drivers/host/) and [Compose merge rules](https://docs.docker.com/reference/compose-file/merge/).

Change the existing `COMPOSE_FILE` entry in `.env` to:

```dotenv
COMPOSE_FILE=compose.production.yml:compose.host-local.yml
```

Use `http://127.0.0.1:8788` for the worker and `http://127.0.0.1:8787/v1` for the AI bridge in the next step. These addresses refer to the same Linux environment that runs Docker Engine, including WSL. This overlay is for the standard rootful Docker Engine, not Docker Desktop or rootless networking.

### Docker Desktop on Linux

Keep `COMPOSE_FILE=compose.production.yml`. Use `http://host.docker.internal:8788` and `http://host.docker.internal:8787/v1`, respectively, following the existing Desktop setup in the service guides. The Windows full-workflow instructions above use Engine inside WSL; Desktop's Windows-to-WSL service routing has not been validated here.

## 5. Start the services you need

Run these processes as the user who owns the LaTeX repository and CLI login. Keep tokens private and distinct from provider API keys. Generate one token per service with `openssl rand -hex 32`.

### Preparation worker

Follow [Host worker](application-preparation.md#host-worker) to create `~/.config/dossier-application-worker.env`, mode 600. Fill in actual absolute **Linux** paths. Set `DOSSIER_WORKER_DATA_DIR` and `DOSSIER_WORKER_EXPORT_DIR` to private directories outside either source repository, and `DOSSIER_PYTHON_BIN` to the virtual environment's Python. Only configure the CLI you intend to use.

In the app's `.env`, set:

```dotenv
DOSSIER_WORKER_URL=http://127.0.0.1:8788
DOSSIER_WORKER_TOKEN=PASTE_THE_SAME_WORKER_TOKEN
```

The URL above is for the Engine overlay; use the Desktop address from step 4 when appropriate. Start the worker from the BtalaLos root in a separate Ubuntu terminal:

```sh
node --env-file="$HOME/.config/dossier-application-worker.env" scripts/application-worker.mjs
```

Leave that terminal open. In another terminal at the BtalaLos root, apply the app configuration:

```sh
docker compose config --quiet
docker compose up -d
```

`config --quiet` validates without printing the resolved secrets. Open **Settings → LaTeX project**, browse the repository, select entrypoints and editable files, validate the CLI, and save. In **Job profiles and bundles**, upload supporting PDFs and choose their order. Set your own final PDF filename; the current initial default contains the maintainer's name.

### Codex HTTP bridge

This is optional for LaTeX preparation: the worker invokes its CLI directly. Use it when the app's native AI tasks should use your Codex account.

Follow [Start the bridge](codex-cli.md#start-the-bridge) to create `~/.config/dossier-codex-bridge.env`, mode 600, with the bridge token and actual Codex path. Start it in another Ubuntu terminal:

```sh
node --env-file="$HOME/.config/dossier-codex-bridge.env" scripts/codex-bridge.mjs
```

Set `DOSSIER_AI_TIMEOUT_SECONDS=300` in the app's `.env` and run `docker compose up -d` again. In **Settings → AI provider**, choose **OpenAI-compatible**, use the bridge URL for your network mode from step 4, and put the **bridge token** in its API key field. Load the models, choose a supported effort, and test the connection.

CLI inference still uses the provider's cloud service, internet access, and account limits. CLI authentication is not bundled with the app and is not copied into Docker.

## 6. Verify, stop, and restart

Prepare one sample application and check the CV, letter, merged PDF, and source diff. For an email posting, check the editable local draft without connecting Gmail. For a portal posting without an email, check that the package completes and the continuation link appears. These steps do not submit an application.

On WSL or a headless Linux server, use **Download** for PDFs. The folder button requires a Linux desktop session and `gdbus`; opening Windows Explorer is not implemented. A failed folder reveal does not invalidate a downloadable PDF.

Optional user services are supplied in `scripts/dossier-application-worker.service` and `scripts/dossier-codex-bridge.service`. Follow the service guides after foreground operation works. Their environment files must contain the correct script path and a `PATH` containing Node and the host tools. A user service does not automatically start WSL when Windows starts. Keep WSL running while using the app.

From the BtalaLos root:

```sh
docker compose ps
docker compose logs --tail=80 app
docker compose stop
docker compose start
```

Stop foreground host services with Ctrl+C and rerun their commands to restart. Back up through the app and separately back up the external Git repository and host export directories. Ordinary container stops retain volumes. Do not delete volumes when upgrading; keep `.env` and its encryption secret.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `docker` unavailable in Ubuntu | Confirm the selected Engine is installed and running there; do not mix Desktop integration and a second daemon |
| Password or secret error at startup | Set the generated hash and secret in `.env`; retain `COMPOSE_FILE` and `DOSSIER_IMAGE` |
| Worker or bridge connection refused | Start the service; match the URL to step 4; with Engine apply the overlay rather than only the hostname mapping |
| Unknown `!reset` tag | Upgrade the Compose plugin to a version supporting the merge tag |
| Database connection fails after overlay | Check loopback port 55432, the overridden database URL, and DB health; changing `POSTGRES_PASSWORD` does not reset an existing database's password |
| CLI login or model lookup fails | Check login under the service user, executable paths, and supported CLI flags; Windows and WSL logins are separate |
| TeX compilation fails | Read the saved compiler log; install the missing package/font in the worker environment and verify the committed base project |
| Works in a terminal but not systemd | Check the user service's explicit `PATH`, executable paths, and environment file |
| Windows localhost page unavailable | Check WSL and Docker are running, then inspect app logs and Microsoft's WSL networking guidance |

## Validation status

These installation steps were checked against the current source and official platform documentation. The Engine overlay is checked with Compose configuration parsing. This documentation update does not constitute a clean-machine installation test on Ubuntu or Windows, a live provider test, or validation of a user's LaTeX template. See [earlier application validation](application-preparation-validation.md) for the separately recorded runtime tests.

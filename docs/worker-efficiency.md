# Worker image and Compose efficiency review

Reviewed on **30 October 2026** after implementing the container worker. The final package policy follows the revised request: install the necessary compilation runtimes, not `texlive-full`.

## Measurements

The initial full-collection build was stopped by Docker's available storage. Its APT estimate was **4,646 MB of downloads and 8,478 MB installed**. Removing documentation packages from the full collection still estimated **2,430 MB downloaded and 5,663 MB installed**. Neither is the final configuration.

The selected-runtime image builds successfully as `btalalos-worker:local`. Docker Desktop's image listing reports approximately **1.34 GB local disk usage**, including its image storage accounting. `docker image history` reports approximately **996 MB of unpacked layers**, dominated by:

| Layer | Approximate size |
| --- | --- |
| Selected system/TeX/PDF/Python runtime packages | 714 MB |
| Node.js executable | 127 MB |
| Python virtual environment with PyMuPDF | 67 MB |
| Debian slim base | 88 MB |
| Worker scripts, notices, and metadata | Less than 1 MB |

These are local amd64 build measurements, not a registry download-size promise. APT's installed-size estimates and Docker's layer/disk accounting are different measures. Additional template packages and other architectures change the result.

Source-only rebuilds reused the system tools and Python layers. The dedicated build-context allowlist transferred less than 100 kB of worker source on the initial build, excluding the web application's dependencies, build output, local data, credentials, and documents.

## Changes retained after reviewing the configuration

- **One worker service for all engines and PDF operations.** No separate Python, TeX-engine, CLI, or desktop-helper containers. The companion runs on the host; web and database services retain their existing separation.
- **Selected runtime packages with `--no-install-recommends`.** All three configured TeX engines remain installed. Template-specific additions are explicit build arguments rather than runtime installation or provider/compiler fallback.
- **Install-time documentation filtering.** Offline manuals and man pages are excluded before layers are committed; package copyright notices and shared license texts remain. APT lists and package archives are removed in the installation layer.
- **Copy only Node's executable from its build stage.** The final image omits npm, Yarn, and the web app's JavaScript dependencies and Chromium. PyMuPDF is installed from a binary wheel, without compiler toolchains; pip is removed afterward.
- **Dependency layers precede source copies.** Editing worker code does not redownload TeX or Python dependencies. Changing host UID/GID requires configuration, not a separate image build per user.
- **No source-tree bind mount over the worker runtime.** Only the external repository root, worker data, and exports are shared. Their matching absolute paths preserve host editing and Git worktree metadata. Missing host directories fail explicitly instead of being created as root-owned empty directories.
- **Read-only runtime with a bounded temporary filesystem.** `/tmp` is a 512 MiB tmpfs maximum, not a reservation. The configurable 2 GiB memory maximum and PID limit bound worker resources; unusually large templates/packages may need a higher memory limit.
- **No redundant published worker port on Desktop.** App-to-worker traffic uses service-name networking. The native Engine/WSL override uses loopback listeners and a loopback-only database mapping to reach the private host companion.
- **Bounded worker logs and cleaned operation files.** Container logs rotate at 10 MB with three files. Temporary PDF input/output copies are removed after completed or failed operations. Durable receipts, source snapshots, Git worktrees, and archived packages are retained for existing retry/history behavior.

This applies Docker's documented [build-layer and package-installation practices](https://docs.docker.com/build/building/best-practices/) and [Compose service networking](https://docs.docker.com/compose/how-tos/networking/).

## Functional boundaries

The app-facing operation protocol and database schema are unchanged. The worker forwards only CLI discovery, structured generation, and export reveal to the host companion. Local compile/merge operations do not require the companion to be online. CLI authentication is never included in the image or mounted into it.

LuaLaTeX's standard font loader cannot operate normally with the legacy `--safer` option and restrictive absolute-input setting. Container mode uses `--nosocket`, permits the font loader's absolute inputs, retains shell-escape/output restrictions, and relies on the non-root read-only container and explicit mounts. The all-host worker keeps its previous flags. Use trusted LaTeX projects; the compiler can access mounted files.

The package selection is intentionally smaller than a full TeX distribution. Custom fonts, language collections, and uncommon template packages require an explicit build extension or read-only font mount, as described in [container setup](container-worker.md).

## Validation

- The image builds successfully with Node.js 24 and PyMuPDF 1.28.2; package copyright notices remain present.
- All **26** worker, host-companion, and existing Codex-bridge regression tests pass, including missing-mount and symlink-alias startup checks. They use fixture CLIs and existing test tools; no live cloud requests or email sends are made.
- Production plus preparation Compose configurations parse for both Desktop and native Engine/WSL. Checks cover shared paths, non-root identity, read-only root, no worker port publication, host-mode overrides, and explicit fork image defaults.
- Targeted ESLint and scoped whitespace checks pass.

The opt-in Docker integration test, `scripts/worker-container.test.mjs`, **passes on Docker Desktop on Linux**. It uses no host Python, TeX, or Poppler. It verifies both fixture CLI adapters over the companion connection, all three TeX engines, one-page CV output, ordered CV/supporting/letter merging with retained hyperlinks, original-checkout integrity, temporary-file cleanup, receipt replay after container recreation, and host edits read from the preserved worktree. Test repositories are temporary and Git-ignored.

Native Engine/WSL networking has configuration validation only on this machine. Native Windows execution, a clean Windows/WSL installation, the owner's private LaTeX project, and live Claude compatibility are not established by these checks. No running application or host service is replaced by the test.

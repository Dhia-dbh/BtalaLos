# Packaging options for BtalaLos

There is no BtalaLos desktop installer or standalone executable in this repository today. The web Docker image bundles the web runtime, application dependencies, Chromium, and native fonts. PostgreSQL runs in a separate container. The [preparation worker image](container-worker.md) now bundles Git, TeX compilation runtimes, Poppler, Python, and PyMuPDF. A small host companion uses the authenticated host coding CLI and opens local folders. The all-host worker remains an alternative.

## Practical choices

| Delivery | What users still set up | Work needed in this project |
| --- | --- | --- |
| Prebuilt Docker images with a setup launcher | Docker, host Node/CLI, and CLI login | Publish fork images; generate configuration and secrets; validate prerequisites; start services and open the browser |
| Containerized preparation tools plus a launcher | Docker, host Node/CLI, provider login, repository selection | Worker image and host connection are implemented; a setup launcher and published worker releases remain future work |
| WSL-based Windows installer | WSL/virtualization where unavailable, provider login, repository selection | Automate Linux environment setup, downloads, service lifecycle, upgrades, and Windows integration |
| Native desktop installer | Provider login and repository selection; template-specific fonts/packages where absent | Package a UI and managed backend/database, port Unix process handling, bundle platform tools, and implement updates and lifecycle management |

The worker container is implemented; the launchers, desktop installers, and published worker releases in this table are proposals. Use the worker guide for current installation commands.

## Recommended next step

The next distribution step is **published Docker images and a setup launcher** around the implemented worker container. This preserves the current web application and PostgreSQL model while removing most manual tool installation. The launcher could be distributed as an executable, but Docker would remain a prerequisite unless its installation is separately handled.

In container mode the worker delegates CLI discovery and structured generation to the private host companion, retaining host authentication. The all-host mode still invokes its CLI directly. The existing Codex OpenAI-compatible bridge remains separate for native AI tasks. Do not copy a developer's credentials into a distributed image.

The worker configuration uses explicit repository/data mounts at matching host/container paths, configurable UID/GID, and durable worktrees/receipts. The host companion preserves Linux folder opening. Only documented TeX packages are guaranteed; arbitrary LaTeX projects may require extra fonts or packages.

## Can it be a normal installable desktop app?

Yes, but packaging the current server inside a window is only part of the work. [Electron Forge](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging) can produce desktop installers. It does not automatically package PostgreSQL, Python, TeX, Git, coding CLIs, or their required libraries.

A native package would need to:

1. Start and stop the application server, private services, and a managed database without conflicting ports or orphan processes.
2. Keep user data and secrets outside the installation directory, with safe upgrades, migrations, backups, and uninstall behavior.
3. Ship platform-specific Git, TeX engines/`latexmk`, Poppler, Python/PyMuPDF, and required fonts, or download a versioned tool bundle during setup.
4. Adapt process-group cancellation, executable discovery, services, and folder opening for Windows.
5. Provide first-run CLI authentication and test the supported CLI versions; a subscription or cloud account cannot be supplied by the app.
6. Sign installers where appropriate, distribute updates, and retain the applicable source, license, and third-party notices.

Replacing PostgreSQL with SQLite could reduce distribution complexity, but would be a separate database migration project. It is not required for desktop packaging and should not be assumed to work with the existing schema unchanged.

## Size and connectivity

An installer can hide dependency installation; it cannot remove those dependencies. A broad TeX distribution can add several gigabytes. A smaller tool bundle is feasible only if the supported TeX packages, fonts, operating systems, and architectures are defined. A single launcher executable can manage downloaded assets; a fully self-contained portable distribution would still need writable storage for the database, documents, and runtime state.

An offline installer can include application binaries and TeX packages. AI generation through Codex or Claude still needs provider connectivity and the user's authentication. Local-model operation is a different deployment choice with its own model downloads and hardware requirements.

The current [Linux and Windows installation guide](installation.md) remains the runnable route. Building an installer would be a separate implementation task, with clean-machine tests for each supported operating system.

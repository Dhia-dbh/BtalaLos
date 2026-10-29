# Application preparation

This branch adds Git-based LaTeX preparation alongside Dossier's native document editor. No data is imported from Job Application Automation.

## Host worker

Dossier stays in Docker. A separate private Node.js worker runs on the Linux computer holding the LaTeX Git repository and the authenticated coding CLIs. It uses Git, `latexmk`, the chosen TeX engine, `pdfinfo`, `pdftotext`, `pdfunite`, and optionally `gdbus` for the folder button. Install the TeX packages and fonts your project requires. Codex and Claude Code must be installed and signed in with subscription accounts under the worker's user. Node 22 or later runs the host worker; Dossier itself requires Node 24.

Create `~/.config/dossier-application-worker.env` with mode 600:

```dotenv
DOSSIER_WORKER_TOKEN=REPLACE_WITH_A_RANDOM_TOKEN_OF_AT_LEAST_32_CHARACTERS
DOSSIER_WORKER_REPOSITORY=/absolute/path/to/your/latex-repository
DOSSIER_WORKER_DATA_DIR=/absolute/path/to/private/dossier-worker-data
DOSSIER_WORKER_EXPORT_DIR=/absolute/path/to/application-folders
DOSSIER_WORKER_SCRIPT=/absolute/path/to/dossier/scripts/application-worker.mjs
DOSSIER_CODEX_BIN=/absolute/path/to/codex
DOSSIER_CLAUDE_BIN=/absolute/path/to/claude
PATH=/directory/containing/node:/usr/local/bin:/usr/bin:/bin
```

Generate the token with `openssl rand -hex 32`. The repository must be a Git repository root. The worker accepts only that repository, validates relative paths, and rejects symbolic links. Choose private data and export directories separate from the repository and from Job Application Automation's managed worktrees.

Run in the foreground:

```sh
node --env-file="$HOME/.config/dossier-application-worker.env" scripts/application-worker.mjs
```

Or copy `scripts/dossier-application-worker.service` into `~/.config/systemd/user/`, then run:

```sh
systemctl --user daemon-reload
systemctl --user enable --now dossier-application-worker.service
```

Run one worker per data directory. Its default listener is `127.0.0.1:8788`; `DOSSIER_WORKER_PORT` changes the port. Run it inside the desktop user session for folder opening. The worker checks the selected CLI when requested; a missing Claude installation does not prevent Codex operations.

## Connect Dossier

Set these deployment environment variables and recreate the app container:

```dotenv
DOSSIER_WORKER_URL=http://host.docker.internal:8788
DOSSIER_WORKER_TOKEN=THE_SAME_LOCAL_TOKEN
```

The loopback URL is reachable through `host.docker.internal` on the existing Docker Desktop setup. Native Docker Engine requires an explicitly configured private network route to the host. Do not expose the worker publicly or mount CLI credentials into the container. The existing Codex OpenAI-compatible bridge remains separate.

Build the Dossier image from this branch. Apply Prisma migrations through the usual startup process. The additive migration keeps every existing application in native mode.

## Configure and use

1. Open **Preparation** in the sidebar. Upload supporting PDFs and create named application profiles. Each profile contains exactly one CV and one cover letter, plus the selected supporting documents in the chosen order. Use the up/down controls to change that order.
2. Configure the Git repository, committed base reference, CV and letter entrypoints, editable `.tex` paths, TeX engine, and final filename. Select the CLI, load its models, and choose a supported thinking effort. Select applicant-context PDFs explicitly. Save the project after validation.
3. In **New application**, choose **LaTeX project**, select a profile and the CLI/model for this run, paste the posting, and start preparation. The posting is saved before preparation starts. Native applications can select a package profile while retaining the existing analysis/editor flow.
4. Preparation automatically analyzes the posting, creates a `dossier-<application-id>` branch and isolated worktree, tailors authorized source files, compiles both PDFs, merges the package, exports it, and writes a local email draft. The original checkout is not switched or edited. Generated source changes remain in the worktree; no Git commit is created automatically.
5. Each LaTeX PDF must have exactly one page. Up to two additional content-shortening rounds are allowed. Continued overflow stops preparation before package publication and drafting. Native documents retain Dossier's existing length settings.
6. Review PDFs, saved sources, diffs, and compiler logs. Use revision instructions for a fresh AI preparation. Direct worktree edits are read when starting a fresh revision; unexpected changes during a run stop the affected step.
7. Edit or copy the recipient, subject, and body. Download the merged PDF or use the folder button. Gmail sending uses the reviewed package and requires explicit confirmation. Drafting never marks the application as sent.

The final filename starts as `BenHamouda_Dhia.pdf` and is configurable. The worker writes the current file plus `-v1`, `-v2`, and later archives under a branch-named folder for LaTeX applications, or `native-<application-id>` for native applications. Folder opening always occurs on the Linux host, including when browsing remotely. A desktop-session error does not prevent PDF download.

## Replacements, retries, and history

Replacing a supporting document creates a new version and retains its profile selections. Earlier packages keep their original bytes. Active document names are unique ignoring case and surrounding spaces. Remove a document from profiles and context before deleting it.

**Regenerate merged PDF** uses the previous package's CV and cover-letter PDFs with the current profile and supporting-document versions. It does not run AI or LaTeX. **Build document package** renders the current native documents. **Prepare with AI** starts a fresh LaTeX revision.

Preparation runs keep stage timestamps, durations, errors, attempts, and the exact LaTeX generation requests. Changing the CLI for one preparation does not change the project default. Retry reuses completed stages and the original snapshot. A fresh preparation uses current configuration and sources. Restarts mark unfinished runs as failed; they do not automatically replay work. The previous successful package remains downloadable after a later failure. For missing worktrees or conflicting Git branches, restore or reconcile host Git state before retrying.

## Backup and restore

New exports and nightly backups are ZIP archives containing `data.json` and the saved supporting PDFs, generated PDFs, source snapshots, diffs, and logs. JSON exports from earlier Dossier versions remain importable. Imports validate artifact checksums and safe filenames. The default archive import limit is 200 MiB; individual supporting PDFs are limited to 25 MiB. Configure the reverse proxy to allow these request sizes.

Deleting Dossier records does not remove host Git branches, worktrees, exported folders, or worker receipts. Manage those host files separately, especially if you edited a worktree by hand.

Host CLI authentication, worker credentials, and the external Git repository are not included. Back up that repository separately. Restored PDFs can be downloaded immediately. Restored history cannot resume host operations; reconnect the worker and configure the project before preparing again.

## Validation

```sh
yarn test:application-worker
yarn vitest run --project db src/lib/preparation/service.db.test.ts
yarn lint
yarn typecheck
yarn build
```

Worker and preparation tests use fixture CLIs and temporary Git repositories, real TeX compilation, and an isolated test database. They do not consume coding-agent quota or send email.

See [the validation results](application-preparation-validation.md) for the tested scenarios and remaining deployment checks.

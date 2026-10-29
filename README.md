<p align="center">
  <img src="src/app/icon.svg" alt="BtalaLos logo" width="80" height="80">
</p>

<h1 align="center">BtalaLos</h1>

<p align="center">
  A self-hosted job application manager with AI-assisted LaTeX documents, ordered PDF packages, and editable email drafts.
</p>

<p align="center">
  <a href="https://github.com/Dhia-dbh/BtalaLos">Source</a> · <a href="LICENSE">GNU AGPLv3 only</a> · <a href="NOTICE.md">Attribution</a> · <a href="docs/application-preparation.md">Application preparation</a> · <a href="docs/codex-cli.md">Codex bridge</a>
</p>

## Origin and acknowledgments

BtalaLos is an independently maintained fork of **[Dossier](https://github.com/AienTech/dossier)**, created by **Alien / AienTech** and developed with contributions from its community. This fork builds on Dossier **1.9.2**, commit [`5446f4c`](https://github.com/AienTech/dossier/commit/5446f4cb117b0e4b4bbf26c6156c97406b0a4ff2).

Thank you to the original author and contributors for building Dossier and sharing it under the GNU AGPL. Its application manager, native document editor, interface, AI integrations, and self-hosting infrastructure provide the foundation for this work. Their authors retain copyright in their contributions.

**Dhia Ben Hamouda** maintains the BtalaLos modifications. The new name and logo identify this version; they do not imply authorship of the original project or endorsement by its maintainers. The original Git history is retained. See [NOTICE.md](NOTICE.md) for attribution and [the fork change review](docs/fork-changes.md) for the changes introduced on 29 October 2026.

## What this fork adds

- **Host Codex bridge:** the Docker app sends OpenAI-compatible HTTP requests to a private host service, which invokes the locally authenticated Codex CLI. Settings expose the model catalog and supported thinking efforts. Authentication stays on the host. Inference still uses OpenAI's servers and account limits; this is not local model inference.
- **Existing LaTeX projects:** select a Git repository, CV and motivation-letter entrypoints, and authorized editable `.tex` files. Each application gets a separate branch and worktree. Preparation tailors the sources and compiles both documents without switching or editing the original checkout.
- **Job profiles and PDF packages:** define an ordered package containing one CV, one motivation letter, and selected supporting PDFs. The worker merges them into one PDF with links and annotations retained. Both native and LaTeX documents support packages.
- **Local email drafting:** the preparation workflow saves an editable recipient, subject, and body alongside the package, without requiring Gmail authorization. Copy the message and download the attachment for manual sending. Dossier already provided an email editor; this fork extends it to prepared packages and LaTeX applications.
- **Portal applications:** preparation completes when no recruiter email is found. A verified application link is shown when available. Portal-only applications skip email drafting; when neither destination is found, preparation shows a notice and leaves the recipient empty. Submission remains manual.
- **Preparation history and document versions:** inspect stages, attempts, timestamps, errors, generation requests, source snapshots, diffs, and compiler logs. Replace supporting PDFs without changing older packages. Regenerate a merged PDF from existing CV/letter artifacts without rerunning AI or LaTeX.
- **Artifact-aware backups and sending:** exports and backups include saved preparation artifacts. When using the optional Gmail integration, package sending checks the reviewed email and attachment bytes before sending.

The HTTP AI bridge implements **Codex only**. The separate preparation worker implements **Codex and Claude Code** adapters. **Only Codex has been tested with a live account.** Claude Code has fixture-based test coverage; live compatibility is unverified.

## Features inherited from Dossier

- A career profile, native resume themes, tailored resumes and cover letters, and conversational document editing.
- Job discovery, startup discovery, profile matching, and an optional scheduled job agent.
- Application tracking through a dashboard, board, table, and calendar.
- Local model providers and hosted AI providers, plus an optional Claude connector.
- Optional Gmail and Google Calendar integration, with confirmation before sending.
- Password-protected single-user access, PostgreSQL storage, imports, exports, and scheduled backups.

These capabilities originate in Dossier. The upstream Claude connector is separate from this fork's Claude Code preparation adapter.

## Typical LaTeX workflow

1. Start the app and connect the private host worker.
2. In **Settings → Job profiles and bundles**, upload supporting PDFs and choose their order with the CV and letter.
3. In **Settings → LaTeX project**, select the repository, committed base reference, entrypoints, editable files, TeX engine, package filename, and CLI settings. Select any applicant-context PDFs explicitly.
4. Start a new application, choose its job profile, and paste the posting. Include application URLs when pasting text.
5. Preparation reads the posting, checks its stated submission destinations, creates the worktree, tailors authorized files, compiles the CV and letter, merges the package, and exports it. It drafts an email when appropriate.
6. Review the PDFs, source changes, and submission instructions. Copy the email and attach the downloaded package, continue on the employer's portal, or use the optional confirmed Gmail send.

LaTeX CVs and letters must each fit one page. Preparation can attempt two shortening rounds before stopping. Source changes remain uncommitted in the application's worktree. Preparing documents or drafting an email does not mark an application as sent.

The complete setup, revision, retry, and backup behavior is documented in [Application preparation](docs/application-preparation.md).

## Architecture

| Component | Runs on | Purpose |
| --- | --- | --- |
| Next.js application and PostgreSQL | Docker | Interface, application data, AI tasks, preparation history, and saved artifacts |
| Codex HTTP bridge, port 8787 | Host | Converts supported OpenAI-compatible text requests into `codex exec` calls |
| Application worker, port 8788 | Host | Git worktrees, CLI generation, LaTeX compilation, PDF merging, exports, and folder opening |

The two host services are configured separately. LaTeX preparation uses the worker directly and does not require the HTTP bridge. Native AI tasks can use the bridge through the existing OpenAI-compatible provider.

The host services require private tokens. CLI login credentials remain on the host. A locally installed CLI may still send prompts and selected document content to its provider's cloud service.

## Run this fork with Docker

Run these commands from a checkout of **BtalaLos**. Build from this source so the image includes the fork's changes:

```sh
docker build --target production -t btalalos:local .
cp .env.example .env
docker run --rm -it btalalos:local hash-password
```

Edit `.env` and set:

| Variable | Value |
| --- | --- |
| `DOSSIER_IMAGE` | `btalalos:local` |
| `POSTGRES_PASSWORD` | A random database password, for example from `openssl rand -hex 24` |
| `DOSSIER_PASSWORD` | The password hash printed by the command above |
| `DOSSIER_SECRET` | A secret from `openssl rand -base64 32` |
| `DOSSIER_TELEMETRY` | `off` to disable the inherited upstream usage ping |

Then start the production services:

```sh
docker compose -f compose.production.yml up -d
```

Open [http://localhost:3000](http://localhost:3000). The production Compose file binds the app to loopback by default. Use an HTTPS reverse proxy for remote access.

`compose.production.yml` still defaults to the upstream Dossier image if `DOSSIER_IMAGE` is omitted. Set the image explicitly as above. Existing `DOSSIER_*` configuration names and service filenames are retained for compatibility.

For the additional host features, follow:

- [Codex HTTP bridge setup](docs/codex-cli.md): Node.js 22 or later and an authenticated host Codex CLI.
- [Application worker setup](docs/application-preparation.md): Node.js 22 or later, Git, `latexmk`, the project's TeX engine and fonts, Poppler, Python with the pinned PyMuPDF dependency, and the selected authenticated CLI. Desktop folder opening additionally uses `gdbus` on Linux.

The documented host connection targets **Docker Desktop on Linux**, through `host.docker.internal`. Native Docker Engine needs a separately configured private route to reach the loopback host services. Neither service should be exposed publicly.

## Development and validation

The app uses Next.js 16, React 19, Prisma 7, PostgreSQL 18, Node.js 24, and Yarn 4. See [DEVELOPMENT.md](DEVELOPMENT.md) for the container-based development workflow. Its container-only instructions apply to the app; the optional bridge and preparation worker run on the host.

Dependency-free host-service test runners:

```sh
node --test scripts/codex-bridge.test.mjs
node --test scripts/application-worker.test.mjs
```

Worker integration tests also need the documented Git, TeX, Poppler, and Python dependencies. App checks run through the development container:

```sh
docker/bin/yarn lint
docker/bin/yarn typecheck
docker/bin/yarn test
docker/bin/yarn build
```

See [recorded preparation validation](docs/application-preparation-validation.md) for earlier test results and their limits. They are historical results, not a guarantee that a particular host, account, or LaTeX project has been validated.

## Privacy and upstream references

The inherited [privacy documentation](PRIVACY.md) and [security documentation](SECURITY.md) describe Dossier's original behavior. This fork additionally stores supporting PDFs, generated PDFs, source snapshots, diffs, logs, and preparation requests. Explicitly selected context and document text can be sent to the configured CLI provider. Host repositories, worktrees, exported folders, worker receipts, and CLI authentication are outside the app's backup and deletion lifecycle; manage them separately.

Some application links, update checks, support contacts, and the opt-in usage ping still reference upstream Dossier. They have not all been rebranded. The [fork change review](docs/fork-changes.md#publication-follow-up) identifies these remaining publication tasks. Dossier's maintainers should not be expected to support this fork.

## License

BtalaLos is licensed under the **GNU Affero General Public License, version 3 only** (`AGPL-3.0-only`). [LICENSE](LICENSE) contains the full, unchanged AGPLv3 text after the project notice. [NOTICE.md](NOTICE.md) records original authorship and this fork's modifications.

Copyright in the original Dossier work remains with its authors and contributors. Copyright in modifications by Dhia Ben Hamouda is claimed only for those contributions. Bundled fonts and other third-party components retain their own notices and licenses; see [the font documentation](src/fonts/README.md).

You may use, modify, and redistribute this software under the AGPLv3 conditions. If you run a modified version for users over a network, prominently offer those users free access to the corresponding source for that version, as required by section 13. The software comes without warranty, to the extent permitted by law. See the license for the complete terms.

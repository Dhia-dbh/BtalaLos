# BtalaLos fork change review

Reviewed on **29 October 2026**, against committed source through `31e34ed` and the accompanying documentation changes. This is a source and history review, not a new runtime validation of the application.

## Baseline and commits

The last upstream commit before the fork is **Dossier 1.9.2**, `5446f4cb117b0e4b4bbf26c6156c97406b0a4ff2`, by Alien. The fork retains that history. Between this baseline and `31e34ed`, the diff contains **125 changed files, 8,400 insertions, and 141 deletions**, before this documentation update.

| Commit | Date | Contribution |
| --- | --- | --- |
| `54618ee` | 2026-10-29 | Initial Codex bridge, LaTeX preparation worker, job profiles, artifact storage, local drafting, package-aware Gmail handling, and tests |
| `ffaccd2` | 2026-10-29 | Automated LaTeX flow, settings and repository picker, default document mode, and PyMuPDF merging |
| `d63bfe3` | 2026-10-29 | Posting-link preservation, destination checks, and portal submissions without required email |
| `36358eb` | 2026-10-29 | BtalaLos display name, brand mark, and replacement icons |
| `6e45d95`, `d18f47b` | 2026-10-29 | Merge the workflow and branding work into the main history |
| `31e34ed` | 2026-10-29 | Set the package version to 1.10.0 |

The substantive fork commits above are attributed to Dhia Ben Hamouda in Git. The version number identifies this fork; it is not evidence of an upstream Dossier release.

## Two separate host integrations

The HTTP bridge in [scripts/codex-bridge.mjs](../scripts/codex-bridge.mjs) implements authenticated `/v1/models` and `/v1/chat/completions` endpoints. It invokes `codex exec` using the host's ChatGPT login. The existing [OpenAI-compatible provider](../src/lib/ai/providers/openai-compatible.ts) and [model options](../src/lib/ai/model-options.ts) expose the catalog and supported reasoning efforts in Settings.

This bridge is Codex-specific. It accepts text and JSON-schema requests, rejects streaming and unsupported API features, and limits concurrency to three calls. Codex runs with a read-only sandbox and tools disabled for these text-generation tasks. Temporary schemas are cleaned up and sensitive environment variables are filtered. A local CLI process does not mean local inference: prompts are still processed by the cloud provider.

The [application worker](../scripts/application-worker.mjs) is a second, token-protected HTTP service. It executes host operations and stores operation receipts. Its [operations module](../scripts/application-worker/operations.mjs) implements both Codex and Claude Code generation adapters. Claude Code is not available through the Codex HTTP bridge. Missing Claude installation does not prevent Codex use. Only Codex is reported tested with a live account; fixture tests do not establish live Claude compatibility.

## Existing LaTeX repository support

[Project settings](../src/components/preparation/project-settings.tsx) and the [repository picker](../src/components/preparation/repository-picker.tsx) browse the worker computer and select tracked `.tex` sources. The selected repository and committed base are saved with the run configuration.

The worker creates branch `dossier-<application-id>` and an isolated worktree. It checks that a reused worktree belongs to the selected repository and still has the expected branch. The original checkout is not switched or edited. No automatic Git commit is created.

The CLI returns structured replacements for authorized source files; the worker applies them after checking source hashes. The worker, rather than the CLI, runs Git, LaTeX, and file operations. LaTeX builds disable shell escape and use the selected TeX engine. CV and letter must each have exactly one page; two additional shortening rounds are allowed. Persistent overflow stops preparation before publishing a new package.

The [preparation service](../src/lib/preparation/service.ts) saves source snapshots, diffs, logs, generation requests, stage attempts, and timings. Retries reuse the original run snapshot and completed steps. A fresh preparation uses current configuration and sources. Unexpected changes are checked before source replacement and compilation.

## Ordered packages and supporting documents

The [preparation schemas](../src/lib/preparation/types.ts) require exactly one CV and one letter per package profile, with optional supporting PDFs. Profiles retain their selected order. Applicant-context PDFs are selected separately from package contents.

The host worker invokes [merge_pdfs.py](../scripts/application-worker/merge_pdfs.py), using PyMuPDF to preserve links and annotations. This applies to native and LaTeX application packages. Package filenames are configurable; the current initial default is `BenHamouda_Dhia.pdf`.

Supporting-document replacements create versions. Saved packages retain their original artifacts. Merge-only regeneration uses the previous CV and letter PDFs with the current profile and supporting documents; it does not invoke AI or LaTeX. Export writes a current package and numbered archives to an application folder. Folder opening uses the Linux host's desktop session, even when the browser is remote.

## Email drafting and submission destinations

Dossier already had an editable email document, copy controls, and an optional Gmail integration. This fork extends that foundation with local drafting after LaTeX package preparation and with attachment descriptions for a single merged package. It does not add automatic email submission or require a successful Gmail connection for drafting.

[Application-route verification](../src/lib/preparation/application-route.ts) checks extracted email addresses and application URLs against the posting. Explicitly entered recruiter metadata is handled separately. Fetched posting text now retains link destinations through [posting-fetch.ts](../src/lib/posting-fetch.ts). Quoted instructions must occur in the posting. These are source-presence checks, not independent verification of an employer's identity or the safety of its website.

For a portal URL without a recruiter email, preparation produces the package and skips the email stage. If neither destination is available, it still completes, leaves the recipient empty, and shows a notice. The application page provides the available instructions and a continuation link. The user submits through the portal manually. Pasted text needs the actual destination URLs; hidden links cannot be recovered from words such as "click here" alone.

Optional Gmail sending now checks the current package and reviewed recipient, subject, body, and attachment integrity in [google/send.ts](../src/lib/google/send.ts). Preparing documents or drafting an email does not mark an application as sent.

## Persistence and backup changes

The [Prisma schema](../prisma/schema.prisma) adds preparation configuration, package profiles, versioned supporting documents, runs, and artifacts. Existing applications remain in native mode when the additive migration is applied.

[Archive handling](../src/lib/preparation/archive.ts), [data export](../src/lib/data-export.ts), imports, and backups now include saved preparation artifacts in ZIP archives. Imports validate checksums and safe paths. Earlier JSON exports remain importable. The default archive import limit is 200 MiB; individual supporting PDFs are limited to 25 MiB.

External repositories, Git worktrees, exported folders, worker receipts, and host credentials are not contained in these archives. Deleting application records does not delete those host files. Restored artifact history does not automatically reconnect or resume host operations.

## Validation evidence and limits

The code adds bridge unit tests, worker tests using temporary Git repositories and fixture CLIs, database workflow tests, component tests, and browser preparation scenarios. [The recorded validation report](application-preparation-validation.md) describes earlier runs, including real TeX compilation and PDF link checks. Those results predate some subsequent commits and are not a new test run of this revision.

The publication documentation review does not establish that the live worker, every provider, or a particular private LaTeX project works. Codex live use is reported by the maintainer; Claude Code remains unverified with a live account. No live provider calls or email sends are needed for this documentation update.

## Publication follow-up

The documentation now identifies BtalaLos and its Dossier origin. Remaining upstream references were left in application code and deployment files during this documentation task:

| Location | Current behavior | Publication action |
| --- | --- | --- |
| Git `origin` | Points to `AienTech/dossier` | Configure the fork's own push destination; retain upstream separately if desired |
| `src/lib/releases.ts` | Source/sidebar links and update checks point to Dossier | Point fork source and updates to the actual BtalaLos repository and releases; keep a separate upstream credit |
| `compose.production.yml` | Defaults to `ghcr.io/aientech/dossier:latest` | Use a fork image; README instructions explicitly build and select `btalalos:local` |
| `package.json` | Package name remains `dossier.aien.me` | Review the package identity separately from the already updated UI name |
| `src/lib/usage-ping.ts` | Opt-in ping goes to `telemetry.dossier.aien.me` | Decide and accurately disclose fork telemetry behavior; the README setup disables it |
| `PRIVACY.md`, `SECURITY.md`, Settings, and other links | Upstream policies, wiki, and contact details remain | Publish fork-specific policies and support routes that cover the host services and saved artifacts |
| `.github/workflows/release.yml` and `site/` | Inherited release titles and website branding | Review before publishing releases or enabling the website workflow |

The new public repository URL was not supplied, so no fork URL or registry image has been invented. These documentation changes do not modify the runtime source link. Before offering a hosted modified version to users, ensure the interface prominently offers the corresponding source of the version actually running, as required by [AGPLv3 section 13](../LICENSE). A link only to the original Dossier repository does not provide the fork's source.

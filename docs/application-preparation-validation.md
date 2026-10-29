# Application preparation validation

Validated on 29 October 2026 on `feat/latex-application-workflow`.

| Check | Result |
| --- | --- |
| Full Vitest coverage run | 1,723 passed, 30 skipped across 212 passing files |
| Coverage thresholds | Passed: 87.27% lines, 85.40% statements, 83.54% functions, 78.92% branches |
| Final affected preparation and Gmail tests | 30 passed across 7 files |
| Host worker and existing Codex bridge tests | 17 passed |
| Chromium application, email, native creation, backup, and preparation scenarios | 13 passed, including authentication setup |
| Repeated preparation scenario with stable theme captures and collapsed mobile sidebar | 2 passed, including authentication setup |
| ESLint, TypeScript, production build, and `git diff --check` | Passed |

The coverage run preceded the final source-integrity checks. The affected tests, worker tests, type checks, production build, and browser scenarios passed after those checks were added.

Tests used Node 24, disposable PostgreSQL databases, fixture coding CLIs and AI/Google services, temporary Git repositories, real TeX compilation, and Poppler. No live coding-agent requests or email sends were made. Production data and the external LaTeX repository were not changed.

The browser preparation scenario selected Claude and its model, prepared a LaTeX application, edited the email subject, regenerated the merged PDF, and built a native application package. Downloaded PDFs were checked for one-page CV and letter output, CV/letter/supporting-document order, and retained hyperlink targets. Rendered fixture CV and letter pages were inspected. This does not validate the layout or TeX dependencies of the owner's actual LaTeX project.

Service and worker tests cover page-overflow shortening and final failure, preserved package versions, source and branch changes, unauthorized paths, merge-only regeneration, supporting-document versions, archive round trips, interrupted history, and exact reviewed Gmail attachment bytes. The final Gmail tests reject changed email text, missing review, and corrupted saved PDF bytes before sending.

Light and dark screenshots were inspected. At 390 px width, the existing expanded 260 px sidebar leaves too little space for application content. The preparation controls render with that sidebar collapsed. The shared sidebar behavior was retained. Headless Chromium's PDF iframe was blank in captures; PDF bytes, extracted text, links, and rendered fixture pages were validated separately.

Temporary validation artifacts are available in `/tmp/dossier-preparation-{dark,light,mobile}.png`, `/tmp/dossier-preparation-{cv,letter,merged}.pdf`, and `/tmp/dossier-preparation-{cv,letter}.png`. They contain public test fixtures.

The feature has not been deployed. The production migration, private host worker, authenticated CLI access, project configuration, and desktop folder opening require the setup described in [Application preparation](application-preparation.md). No host service was installed or enabled during validation.

## Settings and PyMuPDF follow-up

The follow-up exposes the project configuration and ordered job profiles in Settings. A saved LaTeX preference now controls the new-application page and first-run guidance. PDF merging uses the pinned PyMuPDF dependency through the host worker.

Validation passed: 60 targeted UI/backend tests, 5 worker tests, and 4 browser checks including authentication setup. ESLint, TypeScript, and the production build passed. The browser scenario verified persistence after reload, the explicit native-mode override, CV/academic-records/letter order, retained PDF links, and both LaTeX and native packages. Light and dark settings screenshots were inspected. Tests used disposable databases and fixture CLIs; the running development database was not changed. The development container uses the edited checkout; no production image or host worker service was deployed.

## Repository picker follow-up

The fixed host repository allowlist was removed. An authenticated folder dialog now browses the worker computer. Selecting a Git repository loads its regular `.tex` files recursively into the CV, cover-letter, and editable-source selectors. The run snapshot supplies the repository for worktree creation; existing worktrees are checked against their Git common directory before reuse.

Validation passed: 20 targeted UI/API/workflow tests, 6 worker tests, and 2 browser checks including authentication setup. ESLint and the production build with TypeScript checks passed. The browser fixture started the worker with a different initial repository, selected the intended project through the dialog, saved and reloaded source selections, and completed LaTeX compilation and PDF bundling. Repository-picker and settings screenshots were inspected. The installed host worker was restarted, and authenticated directory browsing was verified from the running Dossier container. No live AI generation or owner-repository edits were performed.

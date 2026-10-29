# BtalaLos: attribution and modification notice

## Original project

BtalaLos is derived from **Dossier**, created by **Alien / AienTech** and its contributors.

- Original repository: <https://github.com/AienTech/dossier>
- Upstream baseline: Dossier 1.9.2, commit `5446f4cb117b0e4b4bbf26c6156c97406b0a4ff2`, dated 27 October 2026.
- Original authorship and contributions are recorded in the retained Git history and existing notices.
- Copyright in the original code, documentation, and other materials remains with their respective authors and rights holders.

The original project supplies the application manager, native document editors and resume themes, AI-provider integrations, job discovery, Google integration, and much of the interface, storage, deployment, and test infrastructure. BtalaLos builds on that work with gratitude. Renaming the application does not change its origin or transfer ownership of the original contributions.

## Fork modifications

Copyright (C) 2026 Dhia Ben Hamouda, for modifications authored by Dhia Ben Hamouda.

Fork repository: <https://github.com/Dhia-dbh/BtalaLos>.

The fork commits dated **29 October 2026** introduce:

- A private host HTTP bridge to the authenticated Codex CLI, with model and thinking-effort settings.
- A separate host preparation worker with Codex and Claude Code adapters. Only Codex has been tested with a live account; Claude coverage uses fixtures.
- Existing Git-based LaTeX project support, per-application branches and worktrees, authorized source editing, compilation, and one-page document checks.
- Ordered job-profile PDF packages, versioned supporting documents, archived exports, and merge-only regeneration.
- Package-aware local email drafting without mandatory Gmail integration, plus reviewed-package checks for optional Gmail sending.
- Verified posting destinations and portal applications that can complete preparation without a recruiter email.
- Preparation history, saved source changes and logs, and artifact-aware import, export, and backup support.
- The BtalaLos name, replacement brand icons, and the fork's 1.10.0 version number.

The README, project licensing notice, this attribution notice, and the fork change review were updated on **29 October 2026**. See [the review](docs/fork-changes.md) for commit references and implementation details. These notices summarize the fork's changes; the Git history records individual authorship.

## License and third-party materials

The covered application and these fork modifications are distributed under the **GNU Affero General Public License, version 3 only**, SPDX identifier `AGPL-3.0-only`. The full license is in [LICENSE](LICENSE).

Existing copyright, license, attribution, and warranty notices remain applicable. Bundled fonts retain the SIL Open Font License notices in their respective directories; see [src/fonts/README.md](src/fonts/README.md). Other third-party components retain their applicable licenses and notices.

BtalaLos is an independently maintained version. Attribution to Dossier, Alien, AienTech, and other contributors does not imply their endorsement or responsibility for the fork. This notice documents origin and modifications; it does not add restrictions to the AGPLv3 or reassign anyone else's copyright.

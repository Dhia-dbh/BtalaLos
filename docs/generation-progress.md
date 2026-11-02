# Generation progress and usage

Application Preparation shows a segmented stage bar and a collapsed **Generation tasks** list. Errors and retry/cancel actions remain visible. **Generation usage details** contains the recorded stages and AI calls. Application totals include native posting analysis and tailoring, subsequent preparation runs, and email-generation jobs.

Usage records contain stage timestamps, model/provider, effective configured effort when known, and provider-reported input/output tokens. Cached input is included in input totals, not added a second time. Unknown usage is labelled unavailable; mixed reporting is labelled partial. Processing time sums recorded stage attempts and excludes waiting between jobs. Interrupted stages end at their last recorded completion, since the actual interruption time is unknown.

`GenerationTrace` records survive temporary job cleanup once linked to an application. Unclaimed traces follow job retention. Deleting an application deletes its traces. Backup schema 8 includes traces; older backups default to an empty collection. Historical token counts cannot be reconstructed.

## Updating a running installation

1. Apply migrations: `yarn prisma migrate deploy`.
2. Generate the client: `yarn prisma generate`.
3. Restart the app so it loads the new Prisma model.
4. Restart the preparation worker and, when used, its host companion after active preparations finish.

For the development Compose app, run the first two commands with `docker compose exec -T app`, then `docker compose restart app`. Updating source without reloading Prisma can produce an “Unknown field generationTraces” error. An old application's trace collection is valid when empty.

Worker generation requests opt into the metadata envelope with `includeUsage: true`. Existing consumers that do not request it retain their original structured-data response. No extra AI calls are made to measure usage.

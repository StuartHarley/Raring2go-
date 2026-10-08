# Durable Jobs (OPS-001)

Long-running work is queued, retried, idempotent and visible. This document covers the generic job runtime in `@raring2go/workflows`. Domain tables that predate it (`email_send_jobs`, `social_publish_jobs`, `content_website_publishing_jobs`) keep their own state machines and are surfaced in the console through adapters (see "Legacy job sources").

## Data model (migration `0040`)

- `jobs`: one row per unit of work. `kind`, `status`, `idempotency_key` (unique), optional `organisation_id` / `territory_id` scope, `subject_type` + `subject_id` (the domain record the job belongs to), `payload`, `result`, `attempts` / `max_attempts`, `run_after`, lease columns (`locked_by`, `lease_expires_at`), `last_error` / `last_error_code`.
- `job_attempts`: immutable row per attempt (worker, outcome, duration, error), so a failure stays traceable after a retry succeeds.

Statuses: `queued`, `running`, `succeeded`, `dead` (dead-lettered), `cancelled`. A failed attempt with budget left returns to `queued` with a later `run_after`; one with no budget (or a `PermanentJobError`) becomes `dead`.

## Handler contract

```ts
defineJobHandler({
  kind: "publishing.generate_output", // dot-case
  maxAttempts: 5, baseBackoffMs: 30_000, maxBackoffMs: 1_800_000, leaseMs: 300_000,
  handle: async ({ job, attemptNumber }) => ({ ...result })
});
```

- Handlers **must be idempotent**. The runner can crash after the side effect and before recording success; the lease then expires and the job runs again.
- Throw `PermanentJobError` for failures retrying cannot fix; `RetryableJobError({ retryAfterMs })` to honour a provider `Retry-After`.
- A handler that outlives its lease is treated as a retryable `timeout`.
- Error text is bounded and credential-scrubbed before it is stored.

## Enqueueing

`enqueueJob(store, audit, { kind, idempotencyKey, territoryId, subjectType, subjectId, payload })`. The idempotency key is mandatory: a repeated key returns the original job and writes no new audit event. Choose keys that are stable for the business event (e.g. `publish:<territoryEditionId>:<outputKind>`).

## Execution

`GET|POST /api/jobs/run` (Vercel cron, every minute, `CRON_SECRET` bearer in production) enqueues the daily retention job and drains due jobs via `runDueJobs`. Claiming uses `FOR UPDATE SKIP LOCKED`, so overlapping ticks and multiple workers never run the same job concurrently. Dead-lettering writes an `ops.job.dead_lettered` audit event.

Registered kinds today: `ops.prune_job_history` (deletes succeeded/cancelled jobs and attempts older than 30 days; dead-lettered jobs are kept until resolved). New kinds are added in `apps/web/lib/jobs-runtime.ts` (`buildJobRegistry` and `registeredJobKinds`, kept in sync by a test).

## Job Console (`/app/system/jobs`)

Permissions (module `system.jobs`): `view`, `retry`, `cancel`. Defaults: HQ network scope for all three; Super Admin system scope; franchisee `view` on their own territory only. Jobs with no territory are network-level and invisible to territory-scoped users. A territory-scoped user asking for another territory gets an empty list; a direct link to another scope's job returns the same "not found" as a missing id.

- Only `dead`/`cancelled` jobs can be retried, only `queued` jobs cancelled, and retry is offered only when a handler is registered for the kind. Retry gives a fresh attempt budget on top of attempts already used.
- Retry and cancel re-verify the session server-side, check the grant against the job's own scope, and write `ops.job.retry` / `ops.job.cancel` audit events.

## Legacy job sources

The console lists, alongside generic jobs, rows from `email_send_jobs`, `social_publish_jobs`, `content_website_publishing_jobs` and `publication_outputs` (failed/generating/generated; superseded excluded). Each is normalised to the console statuses (`failed` becomes dead-lettered; unknown statuses show as queued with the raw status preserved) and carries the territory of its owning record, so scoping is identical to generic jobs. Rows link to the record they belong to.

Retry from the console is deliberately narrow: only a **failed email send job** can be re-queued (it resumes from its saved cursor, exactly as the automatic retry does). Social posts, website publishing and edition outputs are retried from their own workflows, because those carry domain rules (approval state, no-duplicate-post guarantees) that a status flip would bypass.

## Observability

- **Logging** (`@raring2go/observability`): `createLogger` writes one JSON object per line (`time`, `level`, `service`, `message`, fields). Secrets (`token`, `password`, `apiKey`, ...) are redacted in fields and child context, `Error` objects are serialised, and reserved keys cannot be spoofed. `LOG_LEVEL` selects the minimum level. `child({ correlationId, jobId })` stamps context onto every record.
- **Correlation**: the cron route accepts or mints an `x-correlation-id` (malformed values are replaced), logs with it, and echoes it in the response.
- **Health** (`GET /api/health`): `database` (critical) and `job_queue` checks. Queue health is `degraded` for any dead-lettered job, overdue job or expired lease, and `down` at 25 dead / 50 overdue (stalled worker). Anonymous callers get only the overall status (503 when down); the per-check detail needs `Authorization: Bearer $CRON_SECRET`. The console shows the detailed panel only to users with a network-wide `system.jobs.view` grant.
- Point an uptime monitor at `/api/health` and alert on non-200 or `degraded`.

## Migration and seed impact

- Migration `0040_*` adds `jobs` and `job_attempts` (additive; roll back with `DROP TABLE job_attempts, jobs`).
- Seed adds permissions `system.jobs.{view,retry,cancel}` (ids `…0542-0544`) and grants them to HQ, Super Admin and Franchisee as above. Re-run `pnpm db:seed`.

## Testing

- Unit: `pnpm --filter @raring2go/workflows test` (policy, runner, service tenancy; in-memory store).
- Postgres integration (real SQL: SKIP LOCKED concurrency, lease reclaim, idempotent enqueue, retention): `docker compose up -d db && pnpm db:migrate && RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`.

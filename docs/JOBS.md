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

## Migration and seed impact

- Migration `0040_*` adds `jobs` and `job_attempts` (additive; roll back with `DROP TABLE job_attempts, jobs`).
- Seed adds permissions `system.jobs.{view,retry,cancel}` (ids `…0542-0544`) and grants them to HQ, Super Admin and Franchisee as above. Re-run `pnpm db:seed`.

## Testing

- Unit: `pnpm --filter @raring2go/workflows test` (policy, runner, service tenancy; in-memory store).
- Postgres integration (real SQL: SKIP LOCKED concurrency, lease reclaim, idempotent enqueue, retention): `docker compose up -d db && pnpm db:migrate && RUN_DB_TESTS=1 pnpm --filter @raring2go/workflows test`.

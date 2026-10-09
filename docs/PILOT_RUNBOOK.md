# Pilot Runbook (UAT-004)

For the technical incident owner and whoever is on call. It describes how the system runs and what to do, using only
what exists in the repository. Names and contact details are **not** here: they belong in the ownership table below,
which must be filled in before the controlled pilot.

## 1. Ownership (fill in before pilot sign-off)

| Role | Name | Contact | Deputy |
| --- | --- | --- | --- |
| Product / UAT decision owner | | | |
| Technical incident owner | | | |
| Database and backup owner | | | |
| Email and domain owner | | | |
| Meta / social token owner | | | |
| Storage and scanning owner | | | |
| Accounting provider owner (when chosen) | | | |
| E-signature provider owner (when chosen) | | | |
| Support inbox / front line owner | | | |
| Franchise communications owner | | | |
| Data protection / privacy escalation owner | | | |

## 2. How it runs

- **App:** Next.js on Vercel (`app.raring2go.co.uk` staff, `mis.raring2go.co.uk` public). **Database:** Postgres (Neon). **Files:** R2 behind a ClamAV scanner. **Email:** Postmark (and a connected Microsoft mailbox for some sends). See `docs/DEPLOYMENT.md` for domains and variables.
- **Background work:** one cron calls `GET /api/jobs/run` about every minute with `Authorization: Bearer $CRON_SECRET`. Each tick enqueues the recurring jobs (idempotency keys stop duplicates) and runs what is due. Jobs are visible and retryable in the **Job Console**, `/app/system/jobs` (`docs/JOBS.md`). Recurring kinds: workflow tick, overdue-invoice scan, metrics snapshot, retention, compliance daily, journeys, social publishing, accounting sync, renewals, health alert, history prune.
- **Health:** `GET /api/health` returns `ok`, `degraded` (200) or `down` (503). Send `Authorization: Bearer $CRON_SECRET` for per-check detail: `database`, `job_queue`, `accounting_sync`, `security_config`.
- **Alerting:** the `ops.health_alert` job posts to `ALERT_WEBHOOK_URL` (a plain https chat webhook) when health gets worse, reminds every 6 hours while unhealthy, and says once when it recovers. It only advances its state after the webhook accepted the message. **Also point an external uptime monitor at `/api/health`**: if the worker itself stops, only an outside monitor notices.
- **Logs:** one JSON object per line with `correlationId`; secrets are redacted. Follow a problem with the correlation id from the cron response header `x-correlation-id`.
- **Audit:** `/app/activity` (administrators) filters by action prefix, entity, actor, territory and date. The audit table cannot be edited or deleted, even by SQL.

## 3. Deploying a change

1. Merge to `main` only when CI is green (lint, typecheck, tests with a real Postgres, build, smoke and accessibility checks).
2. Preview deployment: check `/sign-in`, a public area page, and `/api/health`.
3. Migrations: `pnpm db:migrate` against the matching database **before** promoting. Migrations are additive; check the PR for any note. If the PR adds permissions, also run `pnpm db:seed`.
4. Promote. Verify the checklist in `docs/DEPLOYMENT.md`, then `pnpm security:config` with production variables loaded.
5. Record the deployment and evidence in `docs/UAT_EVIDENCE.md`.

**Rollback:** Vercel deployment rollback for application regressions. Database migrations are not rolled back automatically: if a migration must be undone, restore to a point in time (section 6) or apply a reviewed reversal. Decide first whether to pause the cron (section 5) so queued jobs do not run against the old code.

## 4. Diagnosing

| Symptom | Where to look | Usual cause and action |
| --- | --- | --- |
| Alert: `job_queue` degraded | Job Console: filter dead and overdue | A job kind keeps failing: read its last error; fix the cause, then **Retry**. Overdue with no failures: the cron is not firing; check the cron and `CRON_SECRET`. |
| Alert: `accounting_sync` degraded | `/app/finance/accounting` | Accounting system unreachable or rejecting. Items retry on their own, then stop after 8 attempts: fix the cause, then **Retry now**. In production with no provider configured every push fails by design. |
| Alert: `security_config` degraded | `/api/health` detail (finding codes) | A required production setting is missing or weak: set it in Vercel and redeploy. |
| Newsletter did not send | `/app/marketing-command` send exceptions; Job Console email-send jobs | Failed email jobs resume from their saved position when retried: safe to retry. |
| Social post failed or "outcome unknown" | `/app/social`, Job Console | Failed: fix the connection and retry from the post. **Outcome unknown** means the worker died mid-publish: check the Facebook page by hand before doing anything; it is never retried automatically. |
| Signed agreement did not arrive | Audit `franchise.agreement.*`; webhook responses | 401 bad signature or clock skew; 422 means the document was refused (untrusted host, checksum, not a PDF, scan); 5xx the provider will retry. See `docs/ESIGN_PROVIDER_CONTRACT.md`. |
| File upload or download refused | Franchise 360 documents | Not scanned clean, wrong type, over 4 MB, or no permission. Never override the scanner. |
| User cannot sign in | Audit `auth.*`; `users.status` | Request a new link (sign-in page). A disabled account cannot resolve a context. |
| A user sees too much or too little | `/app/roles` | Check assigned roles and scope. Page denial is enforced on the server and tested. |

## 5. Emergency actions

- **Pause all background work:** remove or disable the cron job that calls `/api/jobs/run` (queued jobs wait and are not lost). Re-enable and watch the Job Console drain.
- **Stop one kind of job:** cancel its queued jobs in the Job Console (audited). Social posting and email sends also have their own cancel controls on the post or campaign.
- **Stop sends:** cancel scheduled campaigns from the campaign page; remove the email provider credential to hard-stop (sends then fail visibly and stay retryable).
- **Revoke a compromised session or user:** the person can use **Sign out of all devices** at `/sign-out` after signing in. For an administrator acting on someone else's behalf there is no screen yet (known limitation): remove their roles at `/app/roles`, then set `users.status = 'disabled'` and `auth_sessions.revoked_at = now()` for that user in the database, in a change ticket, and add a note to the incident record. A disabled user cannot resolve any context.
- **Rotate a secret:** change it in Vercel, redeploy. Webhook secrets support rotation (`ESIGN_WEBHOOK_SECRET_PREVIOUS`); provider connection secrets are re-entered through the Connections page.

## 6. Backup and restore

`pnpm drill:backup` proves a dump restores identically (local). For the hosted database follow `docs/BACKUP_RESTORE.md`: restore to a **new** branch or database, never over production; run `pnpm db:migrate`, `pnpm security:config`, re-apply completed erasure requests, then check `/api/health` and the Job Console before re-enabling cron. Record the date, duration and any manual steps as evidence.

## 7. Provider failure drills

`pnpm drill:providers` runs the failure scenarios against the real database and prints a pass/fail table. Live drills with real credentials are in `docs/PROVIDER_FAILURE_DRILLS.md`. Run both before sign-off and attach the output to the sign-off record.

## 8. Known pilot limitations

- No real accounting or e-signature provider yet: development providers only; production fails closed.
- Franchisees manage their own team (Franchise Staff role only) at `/app/team`; every other role is assigned by Head Office.
- No administrator screen to disable a user or end another person's sessions (section 5).
- Impressions, email opens and clicks where a provider does not report them, and social reach are not measured.
- Real-browser accessibility (colour contrast, screen reader) is a manual pass; automated checks cover the server-rendered pages.

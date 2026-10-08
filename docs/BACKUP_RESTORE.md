# Backup and restore

## Proving restore works (local, repeatable)

```bash
pnpm drill:backup
```

`scripts/backup-drill.sh` dumps the local compose database (`pg_dump -Fc`), restores it into a scratch database,
compares **exact** row counts for every table, and checks migrations and foreign keys survived. It never writes to
the source database and removes the scratch database on exit. Last run: 147 tables, 2,764 rows identical,
47 migrations and 363 foreign keys preserved, dump and restore in 1 second.

Run it before every release and after any migration that rewrites data.

## Production (hosted Postgres)

The drill proves the dump format and schema restore cleanly. The hosted database's own recovery must be configured
and rehearsed separately; these are the controller's decisions and provider settings, listed in the release checklist:

| Item | Needed | Notes |
| --- | --- | --- |
| Point-in-time recovery | Enabled, with a retention window agreed with the business | Neon: branch from a timestamp. Rehearse by restoring to a **new branch** and running `pnpm security:gate` against it. |
| Frequency of logical dumps | Daily `pg_dump -Fc` to storage in a different account/region from the database | Optional if PITR meets the recovery-point objective; keeps a provider-independent copy. |
| Recovery objectives | Written RPO and RTO | Decide, then test against them. |
| Encryption | Provider encryption at rest; dumps encrypted before leaving the host | Keep keys separate from the backups. |
| Object storage (uploads) | Bucket versioning and a retention rule; delete protection | R2: enable object versioning; test restoring a deleted object. |
| Restore access | Named owners and a break-glass procedure | The drill needs only database credentials, not application secrets. |
| Erasure vs backups | A restore must not resurrect erased people | After any restore, re-run completed erasure requests (`privacy_requests` with status `completed`) against the restored data, or restore only to a quarantined environment first. |

## After a restore

1. Run `pnpm db:migrate` (a no-op if the dump is current).
2. Run `pnpm security:config` with the target environment loaded.
3. Re-apply completed erasures (see above).
4. Check `/api/health` and the Job Console before re-enabling cron.

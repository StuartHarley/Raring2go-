# Security release checklist

A release is blocked until the automated gate passes and every manual item is either ticked or has a written,
dated exception from the accountable owner.

## Automated (must be green)

```bash
RUN_DB_TESTS=1 pnpm security:gate          # secret scan + security package tests + route inventory
pnpm typecheck && pnpm lint && pnpm test    # the normal quality gate
pnpm drill:backup                           # restore proven against the current schema
APP_ENV=production pnpm security:config     # with the production environment loaded
```

- [ ] `security:scan`: no credentials in tracked files
- [ ] Tenant isolation matrix passes against the seeded RBAC (`tenancy-matrix.integration.test.ts`)
- [ ] Route inventory passes: every endpoint is declared and protected as declared
- [ ] Privacy workflow integration test passes (export, four-eyes erasure, concurrent approval)
- [ ] Retention and rate-limit integration tests pass
- [ ] `security:config` reports no blocking errors for the target environment
- [ ] `/api/health` shows `security_config` ok (with the cron secret for detail)
- [ ] `pnpm drill:backup` passes

## Manual, per release

- [ ] New endpoints, jobs and permissions were added to the route manifest / seed and reviewed for tenant scope
- [ ] New personal data has a retention rule in `retentionPolicies` and is covered by export and erasure
- [ ] Dependency audit reviewed (`pnpm audit`), with any accepted risk written down
- [ ] No debug or fixture sessions reachable (`NODE_ENV=production`, `STORAGE_PROVIDER` not `development`)

## One-time / periodic, outside the repository

- [ ] Database point-in-time recovery enabled; restore rehearsed to a new branch (see `docs/BACKUP_RESTORE.md`)
- [ ] Uploads bucket versioning and delete protection on; deleted-object restore rehearsed
- [ ] Written RPO/RTO agreed and tested
- [ ] Secrets rotated on a schedule and after any staff change: `CRON_SECRET`, `AUDIENCE_UNSUBSCRIBE_SECRET`, provider webhook secrets, storage signing secret, database credentials
- [ ] Data controller decisions recorded: retention for email delivery records, dormant contacts, AI run payloads
- [ ] DPAs and sub-processor list current (database, email, storage, AI, e-sign, hosting)
- [ ] Virus scanner reachable and scanning (`CLAMAV_SCANNER_URL`)
- [ ] Independent penetration test before general availability; findings tracked to closure
- [ ] **IAM-002 follow-up complete** before real franchisee/advertiser users are invited: database-backed permission loading and the role administration screen (see `docs/SECURITY.md`, known gap 1)

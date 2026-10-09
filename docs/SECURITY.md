# Security and data protection baseline (SEC-001)

Package: `packages/security`. Gate: `pnpm security:gate`. Release checklist: `docs/SECURITY_RELEASE_CHECKLIST.md`.
Backups: `docs/BACKUP_RESTORE.md`.

This document says what is enforced, where, and how it is proved. Where something is not done it says so
(see "Known gaps").

## What is enforced, and the test that proves it

| Control | Where | Proof |
| --- | --- | --- |
| Cross-territory and cross-organisation isolation | `@raring2go/permissions` evaluator, per-feature services | `packages/security/src/tenancy-matrix.integration.test.ts` checks the **seeded database RBAC**: franchisee roles never hold network/system scope, every territory grant works on the user's own territory and fails on another and on no territory, Head Office functions are unreachable to franchisees and advertisers, advertisers are confined to their own organisation. Each sensitive feature also has its own cross-tenant tests (jobs, workflows, AI runs, portal, analytics, privacy). |
| Every endpoint has a declared protection | `apps/web/lib/route-security.ts` | `route-security.test.ts` fails if a `route.ts` exists that is not in the manifest, or if its source no longer shows the protection it claims (session, cron secret, signed webhook, rate limit, dev-only). Also forbids wildcard CORS, destructive actions over GET, and hand-rolled cron checks. |
| Durable rate limits | `rate-limit.ts`, `apps/web/lib/rate-limit-runtime.ts` | Postgres-backed fixed-window counters shared by every serverless instance, one atomic upsert per check. Integration test: 12 concurrent callers against a limit of 5 allow exactly 5. Keys are hashes: no IP or email is stored. Live-tested: a 260-request burst returned 177 `429`s with `Retry-After`. |
| Scheduled endpoints fail closed | `cron-auth.ts` | Bearer secret compared in constant time. With no secret configured, only local development and tests are allowed; any deployed build refuses. The previous check keyed off `APP_ENV` (default `development`), so a production deploy that forgot `APP_ENV` was open. |
| Dev storage backend unreachable in deployments | `api/files/development/[...path]/route.ts` | Unauthenticated read/write of disk files; now 404 whenever `NODE_ENV=production` (which includes preview deployments). |
| Secrets not in the repository | `secrets-scan.ts`, `repo-scan.ts` | `pnpm security:scan` and a unit test scan every git-tracked file by credential shape. |
| Production configuration is safe | `config-check.ts` | `pnpm security:config` (run with the production env loaded) fails on missing or weak secrets, the dev storage backend, a local database, non-https `APP_URL`. The same check feeds the `security_config` health check (codes only, never values). |
| Security headers | `apps/web/next.config.ts` | `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS and a CSP limited to `frame-ancestors`, `base-uri`, `object-src`. |
| Retention is enforced, not just declared | `retention.ts`, job `security.enforce_retention` | Daily job deletes expired sessions, sign-in links, invitations, public analytics past their `retain_until` (previously set to 18 months but never deleted), and rate-limit counters. Integration test checks it removes only what is expired. Counts are audited. |
| Data-subject access and erasure | `privacy/`, `/app/privacy` | See below. |
| Webhooks are idempotent across instances | `webhook_event_claims`, `apps/web/lib/email-webhook-runtime.ts` | Each provider event is claimed by a unique (provider, event id) in the same transaction as its work: a retry or a copy arriving on another instance is skipped, a failure rolls the claim back so the retry is processed, and an event for a message not yet recorded is not claimed. A bad signature is 401; a processing failure is 500 so the provider retries. Postgres test: 6 simultaneous copies persist once. Claims are pruned after 90 days. |
| Backups restore | `scripts/backup-drill.sh` | `pnpm drill:backup` dumps, restores into a scratch database and compares exact row counts for every table, plus migrations and foreign keys. |

## Rate limits

Defined in one place (`rateLimitRules`): sign-in link request (5/hour per email, 20/hour per IP), sign-in verify
(30/10 min per IP), invite acceptance (20/10 min per IP), public analytics (120/min per IP), unsubscribe
(30/min per IP), file upload (60/10 min per user), advertiser artwork upload (30/10 min per user), AI assist
(20/hour per territory, env-overridable as before).

Each rule says what happens if the counter store is down: credential, upload and AI endpoints **fail closed**,
public telemetry **fails open** so a limiter outage never takes pages down. A unit test pins that policy.
Sign-in answers identically whether or not an address belongs to anyone, so the limit leaks nothing about accounts.

Fixed windows allow up to twice the limit across a window boundary. That is acceptable for abuse control; use a
sliding window if a limit ever needs to be a hard guarantee.

## Data-subject requests (UK GDPR access and erasure)

`/app/privacy` (Head Office only: subscribers are shared across territories, so no territory grant can act on one).
Permissions: `privacy.request.view|create|decide|export`.

- **Access/export.** Generates a JSON bundle of everything held on the subscriber (contact, subscriptions,
  preferences, consent history, suppressions, saved content, activity, segment memberships, delivery outcomes).
  Generated on demand and downloaded with `no-store`; never stored. Audit records counts only.
- **Erasure.** Needs **two people**: whoever raised it cannot approve or reject it. Approval locks the request row,
  erases and settles in one transaction, so a double click or a race erases once and the other caller is refused.
- **Deadline.** Every request records a one-month due date; the page shows overdue ones.
- **Idempotent.** Re-requesting while one is open returns the open one. If no data is held, the request is answered
  immediately ("no data held").
- **Hash, not address.** The request record and audit trail hold a hash of the email, never the address.

What erasure does, per table:

| Data | Action |
| --- | --- |
| Contact (email, names, tags, metadata) | Replaced by `erased-<id>@erased.invalid`, names nulled, status `erased`, soft-deleted |
| Activity events, saved content, preference profile, segment memberships | Deleted |
| Consent events | **Kept** as proof of what was agreed and when, with IP/user-agent evidence stripped; no longer linked to a real identity |
| Territory subscriptions | Set to unsubscribed, preferences cleared |
| Email delivery records | **Kept** for campaign reporting, address and provider metadata removed |
| Frozen recipient snapshots (campaign send lists) | That one entry rewritten (address, names removed); array order preserved because in-flight sends address recipients by position |
| Suppression list | **Address kept** (an active network-wide suppression is added) so an import or sign-up cannot silently re-subscribe them. This is the one place the address survives; it is the minimum needed to honour the request. |
| Audit events | Append-only and unchanged. Audit metadata for these workflows never contains the address. |

Out of scope: erasure of staff, franchisee or advertiser **user** accounts (a different request type with
different legal bases), and a self-service parent portal (EXT-002).

## Retention

`retentionPolicies` in `retention.ts` is the reviewable statement of what is kept and for how long; rows marked
`enforced` are implemented by the daily job. Decisions still owed by the data controller (not guessed in code):
retention periods for `email_delivery_records`, audience contacts that never engage, and the AI run input/output
payloads.

## Secure file access

Uploads pass type/size validation and virus scanning (ClamAV adapter, `docs/RAILWAY_CLAMAV_SCANNER.md`); access is
checked by organisation/territory scope in `@raring2go/files`; production storage is R2 or a signed-URL backend
with expiring links. The development disk backend is blocked outside local development (above) and
`security:config` rejects `STORAGE_PROVIDER=development` in production.

## Known gaps (not hidden)

1. **Staff delegation is limited to one role.** Franchisees manage their own team at `/app/team` for the Franchise Staff role only (`docs/FRANCHISE_STAFF.md`); everything else is Head Office through `/app/roles`.
2. **CSP `style-src` still allows inline styles.** Scripts are strict (see below); React renders `style` attributes, so
   styles keep `'unsafe-inline'`. Moving to nonce'd styles is a later hardening step.
3. **Audit redaction is by key name** (`password`, `token`, ...). Free-text fields such as decision notes are
   not scanned; the privacy workflows deliberately keep them out of audit metadata.
4. **Provider-side controls are outside the repo:** database point-in-time recovery, secret rotation, WAF/DDoS,
   DPA/sub-processor agreements and a penetration test. See the release checklist.

## Content Security Policy (script-src)

`apps/web/proxy.ts` gives every page request a fresh nonce and sets `Content-Security-Policy` from `lib/csp.ts`:
scripts run only with that nonce (`'strict-dynamic'`), no inline or eval scripts in production, objects and base tags
are blocked, framing is same-origin only, connections are same-origin. Because a nonce must be new per request,
all pages are rendered per request (`export const dynamic = "force-dynamic"` in the root layout). Headers are
checked on a running build by `pnpm --filter @raring2go/web smoke`, which also fails if any emitted script lacks the nonce.
Do not add inline `<script>` tags (JSON-LD data blocks are fine); do not add `'unsafe-inline'` to `script-src`.

## Audit trail and money guards in the database

`audit_events` rejects UPDATE, DELETE and TRUNCATE for every role (migration 0050); the viewer at `/app/activity`
filters by action prefix, entity, actor, territory and date, with keyset paging. Issued-invoice, credit-note and
acceptance guards are described in `docs/FINANCE_WIRING.md`. Tests that must remove their own rows use
`withFinanceGuardsDisabled` (test support only).

## Server actions that receive a bound context

Some actions receive their acting context from the page that rendered them. Each one first calls `assertBoundActor`
(`lib/action-actor.ts`), which proves from the request's session cookie that the signed-in user is the user in the
context and belongs to the organisation and territory named. `lib/page-access.test.ts` fails if a new action file
accepts a context without doing so, and checks role-by-role page access.

## Account recovery

Sign-in is by emailed link. Recovery paths: request a new link from any email the person controls; if they have lost
that email, a Head Office administrator re-invites them at the new address; if a device is lost, they sign in and use
"Sign out of all devices" (`/sign-out`), which ends every session and is audited (`auth.session.revoke_all`).
The sign-in page never reveals whether an address has an account.


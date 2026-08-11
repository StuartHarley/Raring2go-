# UAT Provider Setup Runbook

Status: operational setup guide.

No product features are defined here. Controlled pilot remains AMBER until the live evidence in this runbook is captured.

## Target Architecture

| Surface | Domain | Rule |
| --- | --- | --- |
| Existing public site | `www.raring2go.co.uk` | Leave untouched during UAT. |
| New Next.js public UAT/pilot site | `mis.raring2go.co.uk` | Public pilot surface; keep noindex until cutover approval. |
| Internal operating platform | `app.raring2go.co.uk` | Authenticated HQ/franchise/advertiser operating system. |
| Email sending domain | `mail.raring2go.co.uk` | Postmark-authenticated sending domain. |

Runtime: Vercel.

DNS/security: Cloudflare.

Email: Postmark.

Storage: Cloudflare R2.

File scanning: private ClamAV HTTP scanner.

Social: Meta Facebook Page via provider connection/OAuth.

## 1. Vercel Setup Checklist

1. Import the GitHub repository into Vercel.
2. Set project root to `apps/web` if Vercel is configured per app. If Vercel runs from the monorepo root, keep the root as repository root and use the build/install commands below.
3. Framework preset: Next.js.
4. Install command: `pnpm install --frozen-lockfile`.
5. Build command from repository root: `pnpm build`.
6. Build command from `apps/web` project root: `pnpm --filter @raring2go/web build`.
7. Node.js version: use the repository target, Node `22.18.0` or any Vercel-supported Node 22 runtime compatible with `>=22.18.0 <27`.
8. pnpm version: `11.16.0`.
9. Production branch: `main`.
10. Preview behaviour: every pull request/branch may deploy with preview secrets and preview callback URLs. Never reuse production secrets in preview unless the provider/account owner has explicitly approved it.
11. Database: configure Neon Postgres per environment. Production and preview must not share the same writable database.
12. Add environment variables in Vercel by environment: Production, Preview and Development as needed.
13. Add custom domains:
    - `app.raring2go.co.uk`
    - `mis.raring2go.co.uk`
14. Register provider callbacks:
    - Meta: `https://app.raring2go.co.uk/api/integrations/meta/callback`
    - Postmark webhook: `https://app.raring2go.co.uk/api/integrations/email/webhook`
15. Deployment smoke tests:
    - Open `https://app.raring2go.co.uk/sign-in`.
    - Confirm unauthenticated `/app` redirects to sign-in.
    - Confirm `/app` loads after a valid sign-in.
    - Open `https://mis.raring2go.co.uk/areas/[pilot-territory-slug]`.
    - Confirm `www.raring2go.co.uk` has not changed.
    - Confirm provider callback routes reject invalid requests without leaking secrets.

## 2. Environment Variable Matrix

Never include real secret values in Git, chat, screenshots or evidence notes.

| Group | Variable | Production required? | Preview required? | Safe example format | Secret? | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| Required platform | `APP_ENV` | yes | yes | `production` / `preview` | no | Selects runtime environment behaviour. |
| Required platform | `NEXT_PUBLIC_APP_NAME` | yes | yes | `Raring2go Business-in-a-Box` | no | Public app display name. |
| Required platform | `NODE_VERSION` | recommended | recommended | `22.18.0` | no | Pins Vercel Node runtime where configured. |
| Required platform | `PNPM_VERSION` | recommended | recommended | `11.16.0` | no | Documents expected package manager version. |
| Database | `DATABASE_URL` | yes | yes | `postgresql://user:password@ep-name-pooler.region.aws.neon.tech/db?sslmode=require` | yes | Neon pooled runtime PostgreSQL connection. |
| Database | `DATABASE_MIGRATION_URL` | recommended | recommended | `postgresql://user:password@ep-name.region.aws.neon.tech/db?sslmode=require` | yes | Neon direct/admin URL for migrations. |
| Database | `DATABASE_DIRECT_URL` | no | no | `postgresql://user:password@ep-name.region.aws.neon.tech/db?sslmode=require` | yes | Compatibility alias if `DATABASE_MIGRATION_URL` is not set. |
| Auth | `EMAIL_PROVIDER` | yes | yes | `postmark` | no | Selects email transport for auth and app email. |
| Auth | `EMAIL_FROM` | yes | yes | `no-reply@mail.raring2go.co.uk` | no | Default sender identity. |
| Auth | `APP_URL` | yes | yes | `https://app.raring2go.co.uk` | no | Internal app absolute URL and auth redirect base. |
| SecretStore | `INTEGRATION_SECRET_ENCRYPTION_KEY` | yes | yes | base64 32-byte key | yes | AES-256-GCM key for connected provider credentials. |
| SecretStore | `INTEGRATION_SECRET_KEY_VERSION` | yes | yes | `v1` | no | Stored key version for future rotation. |
| Postmark | `POSTMARK_SERVER_TOKEN` | yes | yes if email tested | `pm-server-token...` | yes | Postmark Server API token. |
| Postmark | `POSTMARK_TRANSACTIONAL_STREAM` | yes | yes | `outbound` | no | Passwordless/transactional stream. |
| Postmark | `POSTMARK_BROADCAST_STREAM` | yes | yes | `broadcast` | no | Newsletter/broadcast stream. |
| Postmark | `POSTMARK_API_BASE_URL` | no | no | `https://api.postmarkapp.com` | no | Optional API override; normally default. |
| Postmark | `POSTMARK_WEBHOOK_SECRET` | yes | yes if webhooks tested | random high-entropy string | yes | App-side webhook authentication secret. |
| Meta | `SOCIAL_PROVIDER` | yes | yes if Meta tested | `meta-facebook-page` | no | Selects live Meta publisher. |
| Meta | `META_APP_ID` | yes | yes if Meta tested | numeric app ID | no | Meta OAuth app ID. |
| Meta | `META_APP_SECRET` | yes | yes if Meta tested | Meta app secret | yes | Server-side OAuth/webhook verification. |
| Meta | `META_OAUTH_REDIRECT_URI` | yes | yes if Meta tested | `https://app.raring2go.co.uk/api/integrations/meta/callback` | no | Registered OAuth callback. |
| Meta | `META_OAUTH_SCOPES` | yes | yes if Meta tested | `pages_manage_posts,pages_read_engagement` | no | Requested Page permissions. |
| Meta | `META_GRAPH_API_VERSION` | yes | yes if Meta tested | `v20.0` | no | Graph API version. |
| R2 | `STORAGE_PROVIDER` | yes | yes if storage tested | `r2` | no | Selects Cloudflare R2 storage. |
| R2 | `R2_ACCOUNT_ID` | yes | yes if storage tested | Cloudflare account ID | yes | R2 account endpoint identifier. |
| R2 | `R2_BUCKET` | yes | yes if storage tested | `raring2go-pilot` | no | Private pilot bucket. |
| R2 | `R2_ACCESS_KEY_ID` | yes | yes if storage tested | R2 access key ID | yes | R2 API credential. |
| R2 | `R2_SECRET_ACCESS_KEY` | yes | yes if storage tested | R2 secret access key | yes | R2 API credential secret. |
| R2 | `STORAGE_URL_TTL_SECONDS` | yes | yes | `900` | no | Signed URL lifetime. |
| Scanner | `SCANNER_PROVIDER` | yes | yes if scanning tested | `clamav-http` | no | Selects private scanner adapter. |
| Scanner | `CLAMAV_SCANNER_ENDPOINT` | yes | yes if scanning tested | `https://scanner.internal.example/scan` | yes | Private scanner service URL. |
| Scanner | `CLAMAV_SCANNER_API_KEY` | yes | yes if scanning tested | random API token | yes | Scanner API authentication. |
| Scanner | `CLAMAV_SCANNER_WEBHOOK_SECRET` | yes if callbacks used | yes if callbacks tested | random high-entropy string | yes | Scan-result callback signature secret. |
| Public URLs | `NEXT_PUBLIC_SITE_URL` | yes | yes | `https://mis.raring2go.co.uk` | no | Public UAT/pilot base URL. |

## 3. Cloudflare DNS Checklist

Records for `app.raring2go.co.uk`:

- Source: Vercel.
- Type/value: use the exact CNAME/A/verification records Vercel supplies for the custom domain.
- Proxy mode: start DNS-only for initial Vercel verification. Enable proxy only after Vercel confirms compatibility and smoke tests pass.

Records for `mis.raring2go.co.uk`:

- Source: Vercel.
- Type/value: use the exact CNAME/A/verification records Vercel supplies.
- Proxy mode: start DNS-only for verification.
- SEO: keep noindex during UAT/pilot and do not make `mis` canonical for the existing public site.

Records for `mail.raring2go.co.uk`:

- Source: Postmark.
- Type/value: DKIM, Return-Path/SPF, DMARC and optional tracking records must be copied exactly from Postmark.
- Proxy mode: DNS-only for mail authentication records.

R2/storage:

- No public R2 custom domain is required for UAT-001E.
- Do not create a public bucket or public object domain unless a later approved ticket requires it.

Cloudflare SSL/TLS:

- Use Full (strict) for proxied HTTPS traffic.
- Keep DNS and certificate validation evidence in UAT records.

Why `www.raring2go.co.uk` remains untouched:

- It is the current live public site.
- The new public pilot is isolated on `mis`.
- A future cutover needs SEO mapping, redirect proof and rollback planning.

## 4. Postmark Live Configuration Runbook

Automated tested:

- Postmark adapter stream selection.
- Provider rejection/outage mapping.
- Webhook event mapping and dedupe.
- Missing configuration failure.
- Credential sanitisation in adapter results.

Live configuration required:

1. Create a Postmark Server for the pilot.
2. Confirm or create transactional stream, usually `outbound`.
3. Create broadcast stream, usually `broadcast`.
4. Add sending domain `mail.raring2go.co.uk`.
5. Add Postmark-supplied DKIM records in Cloudflare.
6. Add Postmark-supplied Return-Path/SPF records in Cloudflare.
7. Add a DMARC record for `mail.raring2go.co.uk` using an agreed pilot policy.
8. Create sender identity such as `no-reply@mail.raring2go.co.uk`.
9. Configure webhook destination: `https://app.raring2go.co.uk/api/integrations/email/webhook`.
10. Configure `POSTMARK_SERVER_TOKEN`, streams, sender and webhook secret in Vercel.

Live evidence required:

1. Passwordless email smoke test delivered to a project-owned mailbox.
2. Transactional send test delivered and visible in Postmark activity.
3. Controlled newsletter send through broadcast stream.
4. Bounce test records provider event and suppression behaviour.
5. Complaint/suppression test records provider event and suppression behaviour.
6. Invalid token test fails visibly and does not leak token material.

Codex must not send live emails without explicit credentials and approval.

## 5. Cloudflare R2 Live Setup Procedure

1. Create a private R2 bucket, for example `raring2go-pilot`.
2. Confirm public bucket access is disabled.
3. Create scoped R2 API credentials for that bucket.
4. Record account ID and bucket name.
5. Configure Vercel secrets for `STORAGE_PROVIDER=r2`, R2 credentials and TTL.
6. Upload smoke test: create a signed upload intent and upload one harmless pilot file.
7. Confirm direct public access to the object fails.
8. Signed download test: mark file clean through scanner workflow and download via signed URL.
9. Cross-territory denial test: a user from Territory A must not receive a usable download for Territory B.
10. Expiry test: expired signed URL must fail.
11. Rejected/unclean test: pending, failed or infected scan status must block download.

No public bucket or R2 public custom domain should be configured for this phase.

## 6. ClamAV Scanner Deployment Recommendation

Current adapter expectation:

- The app calls a private HTTP endpoint with `POST`.
- Request body contains `fileId`, `storageKey`, `contentType` and `checksum`.
- Auth is via `Authorization: Bearer <CLAMAV_SCANNER_API_KEY>`.
- Response should return `status`, `scannedAt`, optional `signature` and `findings`.
- Optional callback events are HMAC-signed with `CLAMAV_SCANNER_WEBHOOK_SECRET`.

Required scan flow:

```text
R2 object -> private scanner fetch/stream -> ClamAV scan -> clean / infected / failed result -> app scan status update
```

Deployment options:

- Small private container/service: lowest conceptual complexity if it can access R2 and is reachable only by the app. Good pilot default.
- Cloud Run/Fly.io/Railway/Render-style private service: acceptable if private networking, secrets, memory and ClamAV definition updates are straightforward.
- Vercel Function: not recommended for actual ClamAV runtime because ClamAV definitions, cold starts, file-size handling and binary runtime needs are awkward.

Recommendation:

- Use a small private container service for pilot.
- Keep it non-public or protected by gateway/network rules plus API key.
- Do not expose it as arbitrary public file scanning.

Operational requirements:

- Network path from app/job runtime to scanner.
- Network path from scanner to R2 object or controlled signed download.
- API key rotation procedure.
- Timeout and max file-size limits agreed before UAT.
- Retry failed scans as operational jobs, not infinite request loops.
- ClamAV definition updates at least daily.
- Logs must include file ID/status/timing only, not file contents, credentials or signed URLs.

Decision required if no private container runtime is available: choose the pilot scanner host before live storage/scanning can become GREEN.

## 7. Meta Live Verification Procedure

Do not change Meta code for this phase.

1. Configure Meta developer app.
2. Add valid OAuth redirect URL: `https://app.raring2go.co.uk/api/integrations/meta/callback`.
3. Confirm app domain/settings include `app.raring2go.co.uk`.
4. Confirm required Page permissions/scopes for the pilot app.
5. Confirm pilot Facebook Page ownership/admin access.
6. In the app, go to `/app/settings/connections`.
7. Start Facebook Page connection.
8. Complete Meta OAuth.
9. If multiple Pages are available, select the intended pilot Page explicitly.
10. Confirm connection health shows healthy.
11. Queue and approve one controlled, clearly labelled pilot post.
12. Publish once.
13. Confirm the external Facebook Page post exists.
14. Confirm internal publication stores an external provider reference.
15. Retry the completed job and confirm no duplicate post appears.
16. Revoke/reconnect and confirm failure/recovery behaviour.
17. Capture screenshots/links in `docs/UAT_EVIDENCE.md`.

Do not mark Meta GREEN until the actual Page post exists and retry/revoke behaviour has been observed.

## 8. Neon Database And Backup Checklist

Pilot database requirements:

- Neon Postgres selected for pilot.
- Separate production and preview Neon branches/databases.
- Runtime `DATABASE_URL` uses the Neon pooled endpoint.
- Migration `DATABASE_MIGRATION_URL` uses the matching Neon direct endpoint where available.
- SSL-required connection string from Neon.
- Migrations run with `pnpm db:migrate` against the matching environment.
- Seeds run only where appropriate. Production seed is blocked unless `ALLOW_PRODUCTION_SEED=true` is intentionally set for a documented recovery.
- Neon backups/PITR or branch restore capability enabled before UAT starts.
- Backup retention agreed before controlled pilot.
- Restore rehearsal completed into an isolated Neon branch/database.
- Restore evidence captured with timestamp, source backup/restore point, target DB and validation checks.

RPO/RTO notes:

- Initial pilot RPO target: 24 hours or better, subject to Neon plan capability.
- Initial pilot RTO target: same working day for controlled pilot, tightened before broader rollout.

Decision required:

- Confirm Neon project/region, production branch/database and preview branching strategy.
- Confirm Neon backup/PITR retention available on the selected plan.

## 9. Recommended Order Of Operations

1. Create Neon project and separate production/preview branches or databases.
2. Create Vercel project and configure non-provider core environment variables.
3. Configure `app.raring2go.co.uk` and `mis.raring2go.co.uk` in Vercel/Cloudflare.
4. Deploy preview, run migrations, run smoke tests.
5. Run the minimal UAT seed only: `pnpm db:seed:uat`.
6. Confirm the `UAT_ADMIN_EMAIL` passwordless sign-in reaches `/app`.
7. Configure Postmark and `mail.raring2go.co.uk` DNS.
8. Configure R2 bucket and private scanner runtime.
9. Configure Meta app and OAuth callback.
10. Run live verification matrix in order: Vercel/public, email, storage/scanning, Meta, backup/restore.
11. Record evidence and defects.
12. Only then consider UAT-002 internal user testing.

## 10. Decisions Required

- Neon project region and production/preview branch naming.
- Neon backup/PITR retention and restore rehearsal owner.
- Whether preview environments can send real email or must use a separate Postmark test server.
- Pilot DMARC policy for `mail.raring2go.co.uk`.
- Private scanner hosting platform.
- Scanner max file size and timeout.
- Backup retention, RPO and RTO.
- Meta pilot Facebook Page owner/admin.
- Whether Cloudflare proxy should remain DNS-only for Vercel domains during UAT or be enabled after verification.

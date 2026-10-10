# Deployment Readiness

Status: UAT-001D implementation guide.

This document defines the Vercel and Cloudflare deployment posture for Internal UAT and controlled pilot. It is operational guidance, not a new product epic.

## Domains

Keep the existing public website untouched during UAT and pilot preparation.

| Surface | Domain | Purpose | Pilot status |
| --- | --- | --- | --- |
| Existing live public site | `www.raring2go.co.uk` | Current production public website | Do not alter during UAT. |
| New Next.js public site | `mis.raring2go.co.uk` | Public/parent discovery UAT and pilot surface | Canonical for the new platform pilot, noindex until cutover. |
| Internal platform | `app.raring2go.co.uk` | HQ/franchise/advertiser operating system | Authenticated application surface. |
| Email sending domain | `mail.raring2go.co.uk` | Postmark authenticated sending domain | Configure via Postmark DNS records. |

## Vercel Project Structure

Use one Vercel project for the Next.js application unless operational evidence shows separate projects are required.

- Production deployment should serve `app.raring2go.co.uk` and `mis.raring2go.co.uk`.
- Preview deployments should use Vercel preview URLs and preview secrets.
- Local development remains `http://localhost:3000`.
- Provider callback URLs must be registered per environment.

## Required Environment Variables

Core:

- `APP_ENV=production` or `preview`
- `APP_URL=https://app.raring2go.co.uk`
- `NEXT_PUBLIC_SITE_URL=https://mis.raring2go.co.uk`
- `NEXT_PUBLIC_APP_NAME=Raring2go Business-in-a-Box`
- `DATABASE_URL`
- `DATABASE_MIGRATION_URL`

Authentication and email:

- `EMAIL_PROVIDER=postmark`
- `EMAIL_FROM=no-reply@mail.raring2go.co.uk`
- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_TRANSACTIONAL_STREAM=outbound`
- `POSTMARK_BROADCAST_STREAM=broadcast`
- `POSTMARK_WEBHOOK_SECRET`

Provider connections and Meta:

- `INTEGRATION_SECRET_ENCRYPTION_KEY`
- `INTEGRATION_SECRET_KEY_VERSION=v1`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI=https://app.raring2go.co.uk/api/integrations/meta/callback`
- `META_OAUTH_SCOPES`
- `META_GRAPH_API_VERSION`
- `SOCIAL_PROVIDER=meta-facebook-page`

Storage and scanning:

- `STORAGE_PROVIDER=r2`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `STORAGE_URL_TTL_SECONDS=900`
- `SCANNER_PROVIDER=clamav-http`
- `CLAMAV_SCANNER_ENDPOINT`
- `CLAMAV_SCANNER_API_KEY`
- `CLAMAV_SCANNER_WEBHOOK_SECRET`

Operations:

- `CRON_SECRET` (protects `/api/jobs/run` and the detailed `/api/health` view)
- `ALERT_WEBHOOK_URL` (plain https chat webhook for health alerts; production config check warns when unset)
- Online payments (see `docs/PAYMENTS.md`): `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, `GOCARDLESS_CLIENT_ID`, `GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_REDIRECT_URI`, `GOCARDLESS_WEBHOOK_SECRET`, `GOCARDLESS_ENVIRONMENT`
- E-signature (see `docs/SIGNWELL.md`): `SIGNWELL_API_KEY`, `SIGNWELL_TEST_MODE` (`false` for live), `SIGNWELL_WEBHOOK_ID` (+ `_PREVIOUS`), `ESIGN_WEBHOOK_SECRET`, `ESIGN_ARTIFACT_HOSTS=www.signwell.com`, optional `SIGNWELL_ADVERTISER_ACCEPTANCE=off`
- `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_OAUTH_REDIRECT_URI=https://app.raring2go.co.uk/api/integrations/xero/callback`, optional `XERO_OAUTH_SCOPES` (see `docs/XERO.md`); `INTEGRATION_SECRET_ENCRYPTION_KEY` (above) protects the stored tokens
- `ESIGN_WEBHOOK_SECRET`, `ESIGN_WEBHOOK_SECRET_PREVIOUS`, `ESIGN_ARTIFACT_HOSTS` (see `docs/ESIGN_PROVIDER_CONTRACT.md`)

Never commit real values. Vercel project/environment secrets are the source of truth for production and preview secrets.

## Neon Postgres

Neon Postgres is the selected managed PostgreSQL provider for the pilot.

- Local development continues to use Docker PostgreSQL.
- Vercel preview deployments must use a separate Neon preview branch/database.
- Vercel production must use the Neon production database.
- Preview `DATABASE_URL` must never point at production.
- Runtime `DATABASE_URL` should use Neon's pooled endpoint for serverless application traffic.
- `DATABASE_MIGRATION_URL` should use Neon's direct endpoint for migrations/admin tasks where available.
- `DATABASE_DIRECT_URL` is accepted as a compatibility alias when `DATABASE_MIGRATION_URL` is not set.

## Setting up and releasing a real environment

The development seed (`pnpm db:seed`) is for local and preview only: it creates demo users, territories, franchises, advertisers and content, and it refuses to run in production. Real environments use **`pnpm db:bootstrap`**, which creates no demo data.

Every run syncs reference data (head-office organisation, roles, the permission catalogue and role grants, the workflow automation system user, CRM pipeline stages, tax rates, compliance requirements, onboarding templates). It only adds, never removes, so access an administrator granted by hand is kept. Given `BOOTSTRAP_ADMIN_EMAIL` it also creates that person as head-office Super Admin on first run, and refuses if any other real user already exists. After that, everyone else is invited from the Roles page.

First set-up of an environment (run from a machine with the Neon *direct* URL as `DATABASE_MIGRATION_URL`):

```bash
pnpm db:migrate
BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" pnpm db:bootstrap
```

**Every release** that adds a migration or a permission: `pnpm db:migrate` then `pnpm db:bootstrap` (no email) against that environment, before or straight after promoting the deployment. Skipping the bootstrap leaves a new screen's permission ungranted, so it shows "access denied" to everyone.

Not created by the bootstrap, and for head office to configure: agreement templates (counsel-approved wording), royalty rules, commercial catalogue and price books, magazine templates (Edition Factory), territories and franchises (use the franchise import or the franchise screens), and provider connections.

## Render service (Railway)

The print/digital PDF renderer (`services/pdf-render`, Chromium + Ghostscript) runs as its own service. Railway builds it from the repository root with `services/pdf-render/Dockerfile`; it must not be exposed without its secret.

- Service variables: `RENDER_API_KEY` (a long random secret), `PORT` (Railway sets it), optional `OUTPUT_INTENT_ICC` and `OUTPUT_INTENT_NAME` (the printer's CMYK profile; without it print renders are refused and only proof output is produced), `RENDER_TIMEOUT_MS`.
- Vercel variables: `RENDER_SERVICE_URL` (the service's https address) and `RENDER_API_KEY` (the same value).
- Check: `GET /health` on the service, then render a digital output from an edition in the app.

Production seeding of demo data is blocked by default by the database package. Do not configure `ALLOW_PRODUCTION_SEED=true` except for an approved, documented recovery operation.

## Cloudflare DNS

Create DNS records in Cloudflare for:

- `app.raring2go.co.uk` -> Vercel target.
- `mis.raring2go.co.uk` -> Vercel target.
- Postmark-provided DNS records for `mail.raring2go.co.uk`.
- Any provider verification CNAME/TXT records required by Vercel, Postmark or Meta.

Do not change `www.raring2go.co.uk` during UAT-001D. Future cutover from `mis.raring2go.co.uk` to `www.raring2go.co.uk` requires a separate migration plan, redirect map and SEO approval.

## Provider Callback URLs

Meta OAuth:

- Production: `https://app.raring2go.co.uk/api/integrations/meta/callback`
- Preview: preview deployment callback URL if Meta test app supports it.
- Local: `http://localhost:3000/api/integrations/meta/callback`

Email webhook:

- Production: `https://app.raring2go.co.uk/api/integrations/email/webhook`
- Preview: preview deployment webhook URL for controlled tests.

Provider callback endpoints must reject missing/invalid secrets and must not write raw provider credential payloads to audit logs.

## Search And SEO During Pilot

`mis.raring2go.co.uk` is the pilot public surface, not the final public cutover.

Pilot policy:

- Keep `mis.raring2go.co.uk` noindex until explicit cutover approval.
- Keep canonical production SEO ownership with `www.raring2go.co.uk` until the cutover ticket.
- Do not publish duplicate indexable local territory pages across both domains.

Cutover requirements later:

- Full URL inventory from current `www`.
- Redirect map preserving existing paths where practical.
- Canonical tag and sitemap update.
- Analytics baseline before and after cutover.
- Rollback plan with DNS TTL and Vercel deployment rollback documented.

## Deployment Checklist

1. Link the repository to the Vercel project.
2. Configure production and preview environment variables, including separate Neon production and preview database URLs.
3. Configure Cloudflare DNS for `app`, `mis` and `mail`.
4. Deploy preview and run auth, provider connection and public page smoke checks.
5. Run migrations against the matching Neon branch/database before promotion.
6. Promote to production only after preview checks pass.
7. Verify `/sign-in`, `/app`, `/areas/[territorySlug]`, `/api/integrations/meta/callback` and `/api/integrations/email/webhook`.
8. Confirm secrets are not present in logs, audit records or client bundles.
9. Record evidence in `docs/UAT_EVIDENCE.md`.

## Rollback

Use Vercel deployment rollback for application regressions. Use Cloudflare DNS rollback only for DNS misconfiguration or domain routing incidents.

Rollback owners must confirm:

- affected domain;
- affected provider callback URL;
- user-visible impact;
- whether queued jobs should be paused;
- whether credentials need rotation;
- evidence recorded in UAT or incident notes.

## Current Readiness

- Vercel/Cloudflare deployment plan: implemented.
- Live deployment configuration: AMBER until Vercel project, domains and environment variables are configured.
- `www.raring2go.co.uk` cutover: deferred.

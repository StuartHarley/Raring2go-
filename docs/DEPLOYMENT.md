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

Never commit real values. Vercel project/environment secrets are the source of truth for production and preview secrets.

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
2. Configure production and preview environment variables.
3. Configure Cloudflare DNS for `app`, `mis` and `mail`.
4. Deploy preview and run auth, provider connection and public page smoke checks.
5. Promote to production only after preview checks pass.
6. Verify `/sign-in`, `/app`, `/areas/[territorySlug]`, `/api/integrations/meta/callback` and `/api/integrations/email/webhook`.
7. Confirm secrets are not present in logs, audit records or client bundles.
8. Record evidence in `docs/UAT_EVIDENCE.md`.

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

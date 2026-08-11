# UAT Evidence Log

Status: active.

This log records UAT and controlled-pilot evidence. It is not a product feature backlog and should be updated only with operational test evidence, provider setup results, defects and sign-off decisions.

## Evidence Entry Template

```text
Scenario ID:
Scenario name:
Tester:
Date/time:
Environment/domain:
Persona/context:
Permissions expected:
Records used:
Steps completed:
Expected result:
Actual result:
Evidence links/screenshots:
Negative/security checks:
Defects raised:
Severity: S0 / S1 / S2 / S3 / none
Retest result:
Scenario status: PASS / AMBER / FAIL
Sign-off:
```

## Defect Severity Reference

- **S0:** active data leak, credential exposure, destructive data loss, legal/finance/compliance integrity breach, or unauthorised cross-tenant access.
- **S1:** pilot-blocking journey failure with no safe workaround, failed auth for intended pilot users, missing mandatory provider path, or broken backup/restore once UAT-004 begins.
- **S2:** important defect with controlled workaround; acceptable only with owner, target date and UAT Lead approval.
- **S3:** usability/polish/content issue that does not block pilot operation or integrity.

## Scenario Register

| Scenario | Status | Notes |
| --- | --- | --- |
| UAT-HQ-001 | AMBER | Script prepared; not executed. |
| UAT-FRN-001 | AMBER | Script prepared; not executed. |
| UAT-COM-001 | AMBER | Script prepared; not executed. |
| UAT-EDT-001 | AMBER | Script prepared; not executed. |
| UAT-MKT-001 | AMBER | Script prepared; not executed. |
| UAT-PAR-001 | AMBER | Script prepared; not executed. |
| UAT-SEC-001 | AMBER | Script prepared; not executed. |
| UAT-PROV-001 | AMBER | Script prepared; not executed. |

## UAT-001 Provider Configuration Preflight

Date: 2026-08-11

Updated architecture note:

UAT-001 is now split into UAT-001A to UAT-001E. Dynamic OAuth credentials such as Facebook Page tokens must not be managed as Vercel environment variables after connection. They require a persisted provider connection record plus a secure `SecretStore` boundary. Vercel environment variables remain appropriate for platform-level encryption keys, app secrets and infrastructure credentials.

Scope:

- Meta Facebook Page provider boundary.
- Real email transport boundary.
- Real storage/scanning boundary.
- Secret-handling and failure-path readiness before live credentials are supplied.

### Automated Provider-Boundary Checks

Passed:

- `pnpm --filter @raring2go/integrations test`
- `pnpm --filter @raring2go/email test`
- `pnpm --filter @raring2go/storage test`

Result:

- Meta adapter tests passed, including missing credentials, Graph API success mapping, authentication failure, webhook signature verification and metadata sanitisation.
- Email provider tests passed, including provider-neutral message validation, passwordless email composition, env provider selection, HTTP adapter behaviour, webhook signature verification and event idempotency.
- Storage tests passed, including safe storage keys, access scoping, signed URLs, scan gating and scanner-result application.

### Current Local Configuration

Current safe local defaults:

- `SOCIAL_PROVIDER=development`
- `EMAIL_PROVIDER=console`
- `STORAGE_PROVIDER=development`

No live provider credentials are present in the local `.env` checked during this preflight.

### Safe Failure Checks

Meta Facebook Page:

- Probe: `SOCIAL_PROVIDER=meta-facebook-page` with no page ID/token.
- Result: `missing_credentials`.
- Message: `Meta Facebook Page publishing requires META_FACEBOOK_PAGE_ID and META_FACEBOOK_PAGE_ACCESS_TOKEN.`
- Status: expected safe failure.

Real email HTTP transport:

- Probe: `EMAIL_PROVIDER=http` with no endpoint.
- Result: `missing_configuration`.
- Message: `EMAIL_PROVIDER=http requires EMAIL_HTTP_ENDPOINT.`
- Status: expected safe failure.

Postmark email transport:

- Implementation: `EmailDeliveryProvider` adapter added for Postmark transactional and broadcast streams.
- Automated tests: pending current UAT-001C quality gate.
- Configuration still required: Postmark Server, sending domain authentication for `mail.raring2go.co.uk`, Vercel/local secrets and webhook secret.
- Live verification still required: passwordless send, transactional send, newsletter send, bounce/complaint webhook and suppression proof.
- Status: AMBER until real Postmark DNS and controlled sends are verified.

Vercel/Cloudflare deployment readiness:

- Implementation: `docs/DEPLOYMENT.md` added for `app.raring2go.co.uk`, `mis.raring2go.co.uk`, `mail.raring2go.co.uk`, provider callbacks, noindex/cutover policy and rollback.
- Automated tests: pending current UAT-001D quality gate for environment URL validation.
- Configuration still required: Vercel project/environment variables, Cloudflare DNS records and preview/production deployment verification.
- Live verification still required: deployed auth, app shell, public territory page, Meta callback and email webhook smoke checks.
- Status: AMBER until deployment and DNS are configured.

Signed URL storage:

- Probe: `STORAGE_PROVIDER=signed-url` with no storage base URL/signing secret.
- Result: `missing_configuration`.
- Message: `STORAGE_PROVIDER=signed-url requires STORAGE_BASE_URL and STORAGE_SIGNING_SECRET.`
- Status: expected safe failure.

### Outstanding Configuration Required

Meta/Facebook:

- `SOCIAL_PROVIDER=meta-facebook-page`
- `META_GRAPH_API_VERSION`
- `META_FACEBOOK_PAGE_ID`
- `META_FACEBOOK_PAGE_ACCESS_TOKEN`
- `META_APP_SECRET` if webhooks are enabled
- Pilot Facebook Page and responsible owner
- Token expiry/renewal owner
- Controlled live-post test evidence

Email:

- Approved real provider/transport choice.
- Sending domain/subdomain.
- DNS authentication evidence such as SPF/DKIM and agreed DMARC posture.
- Provider credentials in deployment secrets.
- Passwordless email smoke test.
- Controlled newsletter/send test.
- Bounce/complaint/suppression event evidence.

Storage/scanning:

- Approved storage backend.
- `STORAGE_PROVIDER=signed-url` or future approved production provider.
- `STORAGE_BASE_URL`
- `STORAGE_SIGNING_SECRET`
- Scanner provider/configuration.
- Authorised upload/download evidence.
- Scan gating evidence for clean and rejected files.

### UAT-001 Status

Status: AMBER.

Implemented status:

- UAT-001A/UAT-001B provider connection framework and Meta OAuth connection foundation are implemented.
- `provider_connections` stores safe connection metadata only.
- Secret material is stored through SecretStore using AES-256-GCM and an environment-supplied encryption key.
- Meta OAuth start/callback routes are present.
- `/app/settings/connections` is present for capability-scoped Facebook Page connection management.
- Existing social publishing can resolve Facebook Page credentials through the scoped provider connection boundary.

Automated test status:

- `pnpm install` passed.
- `pnpm db:generate` created `0032_luxuriant_moon_knight.sql`.
- `pnpm db:migrate` passed.
- `pnpm db:seed` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
- Integration tests cover encrypted secret storage, wrong-key/tamper failure, OAuth state expiry/replay/mismatch, audit-safe connection changes, cross-territory revoke denial, scoped publishing credential resolution and revoked connection publish failure.

Configuration still required:

- Project-owned Meta app credentials.
- Pilot Facebook Page ownership.
- `INTEGRATION_SECRET_ENCRYPTION_KEY` and `INTEGRATION_SECRET_KEY_VERSION` in the target environment.
- `META_APP_ID`, `META_APP_SECRET`, `META_OAUTH_REDIRECT_URI`, `META_OAUTH_SCOPES` and `META_GRAPH_API_VERSION`.

Live verification still required:

- A genuine Facebook Page post must be published and externally verified before Meta live-post readiness can be marked complete.

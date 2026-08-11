# UAT Evidence Log

Status: active.

This log records UAT and controlled-pilot evidence. It is not a product feature backlog and should be updated only with operational test evidence, provider setup results, defects and sign-off decisions.

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

The existing application adapter boundaries and safe failure behaviour are ready. UAT-001A/001B should now implement provider connection lifecycle, scoped permissions and SecretStore-backed Meta OAuth before live Facebook Page verification is attempted. Email, Vercel/Cloudflare and storage/scanning remain UAT-001C to UAT-001E platform infrastructure configuration items.

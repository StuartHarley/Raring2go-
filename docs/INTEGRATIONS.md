# Integration Boundaries

Keep provider-specific code behind adapters. The product should be able to swap providers without changing the domain model.

- E-sign: agreement envelope creation, signer order, reminders, webhook completion, signed PDF/certificate retrieval.
- Payments: card and Direct Debit initiation/status/refund webhooks; idempotent reconciliation.
- Accounting: invoice/payment/credit-note mapping and sync where the accounting ledger remains authoritative.
- Bulk email delivery: send payload, domain authentication status, delivery/bounce/complaint/click events; audience and campaign UX remains native.
- Object storage/file pipeline: original and derived assets, access control, virus/security checks, conversion/preflight jobs.
- Public website/CMS: publish approved articles/events/offers/competitions/digital editions and receive enquiries/subscriptions.
- AI: common gateway exposing existing Raring2go content/events workflows plus future model/tool adapters.

Every webhook must authenticate the sender, deduplicate events and retain the provider event ID in the audit/job history.

## PIL-006 Meta Facebook Page Pilot

The first live social pilot channel is a Facebook Page published through Meta Graph API. The product domain remains provider-neutral: Meta page IDs, access tokens, Graph payloads and webhook signatures belong only inside the social provider adapter or sanitized provider metadata.

### Meta Requirements

- A Meta developer app with Facebook Login/API access suitable for Page publishing.
- A Facebook Page controlled by the pilot business/HQ account.
- A Page access token with the least privileges required for Page publishing and status checks.
- Required permissions/scopes should be confirmed against Meta's current review requirements before pilot, typically including Page-management/publishing capabilities such as `pages_manage_posts`, `pages_read_engagement` and any required business/page access permissions.
- Instagram Business support must be added as a later Meta channel through the same provider boundary, not by changing the publishing domain model.

### Environment Variables

Configure secrets through local `.env` or deployment-platform secrets. Never commit real values.

- `SOCIAL_PROVIDER=meta-facebook-page`
- `META_GRAPH_API_VERSION=v20.0`
- `META_APP_ID`
- `META_APP_SECRET`
- `META_OAUTH_REDIRECT_URI`
- `META_OAUTH_SCOPES`
- `INTEGRATION_SECRET_ENCRYPTION_KEY`
- `INTEGRATION_SECRET_KEY_VERSION`

`META_FACEBOOK_PAGE_ID` and `META_FACEBOOK_PAGE_ACCESS_TOKEN` are retained only as an explicit development/emergency compatibility path. Normal pilot/production operation uses Meta OAuth, `provider_connections` safe metadata and SecretStore-backed Page tokens.

The development provider remains available with `SOCIAL_PROVIDER=development`.

### OAuth Security Notes

Meta connection requests use server-generated OAuth state that is hashed before persistence, short-lived, bound to the authenticated user and requested organisation/territory context, and consumed once. Return paths are restricted to internal application paths.

The current server-side Meta flow does not depend on PKCE because the confidential application exchanges the code server-side with the Meta app secret. If Meta app configuration or review requirements later require PKCE for this app type, the existing OAuth transaction model already stores a code-verifier hash so the exchange can be upgraded without changing the provider connection or social publishing domain model.

### Page Connection Model

Raring2go social account records store provider-neutral account identity and public connection health only. The Facebook Page ID is matched as the account's external account reference. Page token material is stored only through SecretStore, encrypted with an application key supplied through deployment secrets; it is never stored in normal social account, audit, publication or job records.

### Token Lifecycle

Before controlled pilot:

1. Create or select the Meta developer app.
2. Connect the target Facebook Page.
3. Generate the Page access token using an approved admin/business flow.
4. Configure the token in local/preview/production secrets.
5. Record expiry/renewal requirements in the pilot runbook.
6. Rotate/revoke immediately if a token is exposed.

Expired or revoked credentials must fail safely: the publish job remains failed/retryable, the provider error is visible, and no secret material is persisted.

### Webhooks

If Meta webhooks are enabled, configure callback delivery to the application route that processes social provider events. The adapter verifies `x-hub-signature-256` with `META_APP_SECRET`, maps provider event IDs for dedupe, and stores sanitized payloads only.

### Controlled Live-Post Verification

1. Use a non-sensitive approved content variant and a clearly labelled pilot Facebook Page.
2. Confirm `SOCIAL_PROVIDER=meta-facebook-page`, `META_FACEBOOK_PAGE_ID` and `META_FACEBOOK_PAGE_ACCESS_TOKEN` are configured in the target environment.
3. Queue, approve and schedule one Facebook publication through the normal Social queue.
4. Run the publish job once.
5. Confirm the Facebook Page post exists and matches the immutable publication snapshot.
6. Confirm the internal publication is `published`, has an external provider reference, and appears in Marketing Command/My Today.
7. Retry the same completed job and confirm no duplicate Facebook post is created.
8. Revoke or replace the token in a controlled test and confirm failures are visible, recoverable and secret-free.

Live Meta publishing has not been verified until the real Page token and target Page are configured by the project owner.

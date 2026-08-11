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

## UAT-001C Postmark Email Pilot

The pilot email provider is Postmark behind the existing provider-neutral `EmailDeliveryProvider` boundary. Product code sends passwordless, transactional, journey and newsletter messages through `@raring2go/email`; it must not depend on Postmark-specific objects outside the adapter.

### Postmark Requirements

- A Postmark account and Server for Raring2go pilot traffic.
- A verified sender signature or domain for `mail.raring2go.co.uk`.
- A transactional message stream for passwordless sign-in, system and commercial messages.
- A broadcast message stream for newsletters and parent marketing sends.
- Bounce, spam complaint, delivery, open/click and unsubscribe webhooks directed to the application webhook route where enabled.

### Cloudflare DNS For `mail.raring2go.co.uk`

Configure the DNS records supplied by Postmark in Cloudflare for the sending domain. The exact values must come from Postmark, but the expected record families are:

- SPF/return-path record for Postmark's bounce domain.
- DKIM CNAME/TXT records for domain authentication.
- DMARC record for reporting and policy alignment.
- Optional custom tracking domain CNAME if click/open tracking is enabled for pilot.

Do not alter the current `www.raring2go.co.uk` public site while configuring email DNS. Email should use `mail.raring2go.co.uk`.

### Environment Variables

Configure secrets through local `.env` or Vercel deployment secrets. Never commit real values.

- `EMAIL_PROVIDER=postmark`
- `EMAIL_FROM=no-reply@mail.raring2go.co.uk`
- `POSTMARK_SERVER_TOKEN`
- `POSTMARK_TRANSACTIONAL_STREAM=outbound`
- `POSTMARK_BROADCAST_STREAM=broadcast`
- `POSTMARK_API_BASE_URL=https://api.postmarkapp.com`
- `POSTMARK_WEBHOOK_SECRET`

The webhook URL is:

- `https://app.raring2go.co.uk/api/integrations/email/webhook`

Use the corresponding preview URL for preview verification. Webhook requests must include the configured secret through the supported application gateway/header path; unauthenticated webhook payloads fail closed.

### Delivery And Suppression Behaviour

Postmark adapter results expose only provider-neutral message IDs, accepted/rejected recipients and sanitized provider metadata. Server tokens, webhook secrets and raw credential payloads must never be persisted in audit events, React components, public DTOs or general domain records.

Webhook events are mapped into provider-neutral delivery events:

- Delivery -> `delivered`
- Bounce -> `bounced`
- SpamComplaint -> `complained`
- SubscriptionChange/suppression -> `unsubscribed`
- Open -> `opened`
- Click -> `clicked`

The marketing domain owns durable suppression effects for bounced, complained and unsubscribed recipients. Duplicate provider events must be idempotent.

### Controlled Email Verification

1. Configure Postmark Server, streams and `mail.raring2go.co.uk` sender/domain authentication.
2. Add the environment variables in Vercel and local `.env`.
3. Send one passwordless sign-in email and confirm delivery.
4. Send one transactional/commercial test email and confirm it uses the transactional stream.
5. Send one newsletter test email and confirm it uses the broadcast stream.
6. Trigger or replay delivery, bounce and complaint webhooks and confirm dedupe/suppression handling.
7. Temporarily remove or rotate the token in a controlled test and confirm failure is visible and secret-free.

Live Postmark sending is not GREEN until real DNS, sender authentication and controlled sends have been verified.

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

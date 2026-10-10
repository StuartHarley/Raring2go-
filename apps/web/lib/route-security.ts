/**
 * Every route handler in the app, and how it is protected. The accompanying test fails if a
 * route.ts exists that is not listed here (so a new endpoint cannot ship without a decision
 * about who may call it), or if a listed route's source no longer shows the protection it claims.
 * Paths are relative to `apps/web/app`.
 */
export type RouteProtection =
  /** Requires a signed-in session and a permission check before doing anything. */
  | "session"
  /** Scheduled work: needs the CRON_SECRET bearer token. */
  | "cron_secret"
  /** Third-party callback authenticated by verifying the provider's signature. */
  | "signed_webhook"
  /** Public, unauthenticated by design, with a per-caller rate limit. */
  | "public_rate_limited"
  /** Public, unauthenticated by design and exposes nothing and touches no data. */
  | "public_static"
  /** Local-development helper that must answer 404 in any deployed build. */
  | "dev_only";

export type RouteEntry = { protection: RouteProtection; reason: string; extraMarkers?: RegExp[] };

export const routeManifest: Record<string, RouteEntry> = {
  "api/audience/import/route.ts": { protection: "session", reason: "Audience CSV upload (dry run only): needs marketing.import.manage for the territory, per-user rate limited.", extraMarkers: [/firstRateLimitRefusal\(/] },
  "api/franchise/documents/route.ts": { protection: "session", reason: "Franchise document or new version upload: scanned and stored, needs the document upload permission for that franchise, per-user rate limited.", extraMarkers: [/firstRateLimitRefusal\(/] },
  "api/files/development/[...path]/route.ts": { protection: "dev_only", reason: "Local disk storage backend: unauthenticated, so disabled in production builds." },
  "(app)/app/editions/[id]/outputs/[outputId]/route.ts": { protection: "session", reason: "Edition output PDF download: needs edition view for that edition, then a short-lived storage link.", extraMarkers: [/module: "edition"/, /no-store/] },
  "api/editions/[id]/images/route.ts": { protection: "session", reason: "Page studio images: list and upload for an edition the caller can edit, per-user rate limited, type and size checked, scanned.", extraMarkers: [/firstRateLimitRefusal\(/, /edit_local/] },
  "api/advertisers/import/route.ts": { protection: "session", reason: "Advertiser CSV dry run: needs advertiser.import manage for the territory, per-user rate limited, size and format checked, changes no advertiser record.", extraMarkers: [/firstRateLimitRefusal\(/, /advertiser\.import/] },
  "(app)/app/advertisers/import/[id]/report/route.ts": { protection: "session", reason: "Advertiser import reject report: needs advertiser.import manage for that import's territory (a foreign import looks like it does not exist).", extraMarkers: [/advertiser\.import/, /no-store/] },
  "api/files/list/route.ts": { protection: "session", reason: "Lists the caller's own uploaded images." },
  "api/files/upload/route.ts": { protection: "session", reason: "Newsletter image upload, per-user rate limited.", extraMarkers: [/firstRateLimitRefusal\(/] },
  "api/health/route.ts": { protection: "public_static", reason: "Uptime status only; per-check detail needs the cron secret.", extraMarkers: [/isAuthorizedCronRequest\(/] },
  "api/integrations/email/webhook/route.ts": { protection: "signed_webhook", reason: "Email provider delivery events, verified by signature." },
  "api/integrations/signwell/webhook/route.ts": { protection: "signed_webhook", reason: "SignWell callbacks: event hash verified, then confirmed against the SignWell API before anything is applied, then claimed once per event." },
  "api/integrations/esign/webhook/route.ts": { protection: "signed_webhook", reason: "E-signature provider callbacks (provider-neutral), verified by HMAC signature and timestamp, then claimed once per event." },
  "api/integrations/meta/callback/route.ts": { protection: "session", reason: "OAuth callback: needs the session and the issued state." },
  "api/integrations/meta/revoke/route.ts": { protection: "session", reason: "Disconnects a Meta connection." },
  "api/integrations/meta/start/route.ts": { protection: "session", reason: "Begins the Meta OAuth flow." },
  "api/integrations/microsoft/callback/route.ts": { protection: "session", reason: "OAuth callback: needs the session and the issued state." },
  "api/integrations/microsoft/revoke/route.ts": { protection: "session", reason: "Disconnects a Microsoft connection." },
  "api/integrations/microsoft/start/route.ts": { protection: "session", reason: "Begins the Microsoft OAuth flow." },
  "api/integrations/stripe/webhook/route.ts": { protection: "signed_webhook", reason: "Stripe (Connect) payment events, verified by signature and timestamp, then claimed once per event." },
  "api/integrations/gocardless/webhook/route.ts": { protection: "signed_webhook", reason: "GoCardless payment events, verified by HMAC signature, then claimed once per event." },
  "api/integrations/stripe/start/route.ts": { protection: "session", reason: "Begins the Stripe Connect flow." },
  "api/integrations/stripe/callback/route.ts": { protection: "session", reason: "Stripe Connect callback: needs the session and the issued state." },
  "api/integrations/stripe/revoke/route.ts": { protection: "session", reason: "Disconnects a Stripe connection." },
  "api/integrations/gocardless/start/route.ts": { protection: "session", reason: "Begins the GoCardless OAuth flow." },
  "api/integrations/gocardless/callback/route.ts": { protection: "session", reason: "GoCardless callback: needs the session and the issued state." },
  "api/integrations/gocardless/revoke/route.ts": { protection: "session", reason: "Disconnects a GoCardless connection." },
  "api/integrations/bank-details/route.ts": { protection: "session", reason: "Saves the signed-in franchise's own bank details for bank-transfer payments." },
  "api/integrations/xero/callback/route.ts": { protection: "session", reason: "Xero OAuth callback: needs the session and the issued state." },
  "api/integrations/xero/revoke/route.ts": { protection: "session", reason: "Disconnects a Xero connection." },
  "api/integrations/xero/start/route.ts": { protection: "session", reason: "Begins the Xero OAuth flow." },
  "api/integrations/xero/mapping/route.ts": { protection: "session", reason: "Saves the Xero account and tax mapping for the signed-in franchise only." },
  "api/jobs/email-send/route.ts": { protection: "cron_secret", reason: "Newsletter send worker." },
  "api/jobs/journey-execute/route.ts": { protection: "cron_secret", reason: "Journey execution worker." },
  "api/jobs/run/route.ts": { protection: "cron_secret", reason: "General job worker tick." },
  "api/portal/artwork/route.ts": { protection: "session", reason: "Advertiser artwork upload, per-user rate limited.", extraMarkers: [/firstRateLimitRefusal\(/] },
  "api/public/analytics/route.ts": { protection: "public_rate_limited", reason: "Anonymous website analytics events; fails open so telemetry never blocks pages." },
  "api/public/unsubscribe/route.ts": { protection: "public_rate_limited", reason: "One-click unsubscribe, authorised by a signed link token.", extraMarkers: [/verifyUnsubscribeToken\(/] },
  "auth/[...nextauth]/route.ts": { protection: "public_static", reason: "Lists sign-in provider names; the POST handler is rejected." },
  "sign-in/verify/route.ts": { protection: "public_rate_limited", reason: "Consumes a one-time sign-in link.", extraMarkers: [/verifySignIn\(/] },
  "(app)/app/audience/import/[id]/report/route.ts": { protection: "session", reason: "Import reject report download: only for an import in the caller's own territory.", extraMarkers: [/no-store/] },
  "(app)/app/franchisees/[id]/documents/[documentId]/download/route.ts": { protection: "session", reason: "Franchise document download: authorised for that franchise, audited, redirects to a short-lived storage link.", extraMarkers: [/no-store/] },
  "(app)/app/privacy/[id]/export/route.ts": { protection: "session", reason: "Subscriber data export: needs the privacy.request.export permission.", extraMarkers: [/privacy\.request/, /no-store/] }
};

export const protectionMarkers: Record<RouteProtection, RegExp[]> = {
  session: [/sessionToken:\s*cookieStore\.get\(sessionCookieName\)/],
  cron_secret: [/isAuthorizedCronRequest\(/],
  signed_webhook: [/verifyWebhook/],
  public_rate_limited: [/firstRateLimitRefusal\(/],
  public_static: [],
  dev_only: [/NODE_ENV === "production"/]
};

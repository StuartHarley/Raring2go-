# Xero accounting hand-off

Decision (docs/DECISION_BRIEFS.md): Xero, **per franchise**, **push only** (invoices and credit notes go out; nothing is read back).

## What is sent

Every issued invoice and credit note (queued in the same transaction as issuing, see `docs/FINANCE_WIRING.md`) is sent by the background job to the Xero organisation that **its issuing franchise** connected (matched on organisation and territory).

- **Invoice:** `ACCREC`, authorised, amounts exclusive of tax, number = our invoice number (unique in Xero), due and issue dates, one Xero line per invoice line with the mapped account and tax type, and our own tax amount per line so Xero's total equals ours. If Xero's total differs, the push is **refused** and never marked synced.
- **Credit note:** `ACCRECCREDIT`, authorised, then **applied to its invoice** in Xero. It waits (no attempt spent) until its invoice has reached Xero.
- **Contact:** looked up once per advertiser by exact name (an existing Xero contact is reused, otherwise one is created) and remembered, so later documents go straight to it.
- **Idempotency:** a stable key per document is sent with every request, and a duplicate invoice or credit note number is recognised and confirmed rather than failing, so a retry after an unknown outcome never double-records.

## Connecting (each franchisee)

Settings, Connections, **Connect Xero**. Authorise **one** Xero organisation (the first one authorised is used). Then check the **mapping** on the same card: sales account code (default `200`) and tax types (defaults for a UK chart: standard `OUTPUT2`, zero-rated `ZERORATEDOUTPUT`, exempt `EXEMPTOUTPUT`). Those defaults are Xero's standard UK ones; a franchise with a different chart changes them there. An invoice using a tax code with no mapping is refused with a clear message rather than guessed.

Until a franchise connects, its invoices **wait** and are sent as soon as it does (the page `/app/finance/accounting` shows each waiting item and why).

## Setting up the app (one time, Head Office)

1. Create an app at the Xero developer portal (OAuth 2.0, web app). Set the redirect URI to `https://app.raring2go.co.uk/api/integrations/xero/callback` (and a preview/local one if wanted).
2. Set `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_OAUTH_REDIRECT_URI`. Default scopes: `offline_access accounting.transactions accounting.contacts accounting.settings`. **Xero has been moving apps to granular scopes; if Xero's consent screen or API refuses these, set `XERO_OAUTH_SCOPES` to the scopes the portal shows for invoices, credit notes and contacts.** This could not be checked against a live Xero account when this was built, so run one real invoice end to end in a Xero demo company before the pilot.
3. `INTEGRATION_SECRET_ENCRYPTION_KEY` must be set: tokens are stored only in the encrypted secret store.

## Tokens

Access tokens last about 30 minutes; Xero refresh tokens are **single use**. Refreshing takes a per-connection lock, re-reads what is stored, and stores the new pair before releasing it, so two workers asking at once refresh exactly once. If Xero rejects the refresh token the connection is marked **expired** and the franchise is asked to reconnect (items wait; no attempts are burned).

## When something goes wrong

| What you see | Meaning | Who fixes it |
| --- | --- | --- |
| Waiting: no accounting system connected | Franchise has not connected Xero | Franchisee: Connect Xero |
| Waiting: Xero needs to be reconnected | Refresh token refused or access revoked in Xero | Franchisee: Connect Xero again |
| Waiting: credit note, invoice not in Xero yet | Its invoice has not been accepted yet | Fix the invoice's problem first |
| Failed attempts: "No Xero tax type is mapped" / "not a valid code" | Mapping does not match their chart | Franchisee: correct the mapping, then Head Office **Retry now** |
| Failed attempts: "different total" | Xero's tax calculation disagrees with ours (check the tax type's rate) | Fix the tax type mapping, then **Retry now** |
| Rate limited or Xero unavailable | Transient | Retries automatically with backoff |

## Fixes made while building this

Three latent bugs in the shared connection code (unused until a real provider was connected) were fixed and tested against Postgres: the secret was stored before the connection row existed (a foreign-key failure for every provider), a reconnect encrypted the secret for a different id than it was read with, and any partial update of a connection (every token refresh or revoke) overwrote the provider, account id and dates with empty values.

## Tests

`packages/integrations/src/xero.test.ts` (OAuth, request shape, amounts and tax mapping, contact matching, duplicate recovery, token refresh on 401, transient vs rejected, credit allocation), `packages/integrations/src/connections.integration.test.ts` (connect, reconnect and partial updates against Postgres), `apps/web/lib/xero-runtime.test.ts` (the whole hand-off against Postgres with a pretend Xero, including waiting, rejection, revoked access, one refresh under concurrency, and mapping access control).

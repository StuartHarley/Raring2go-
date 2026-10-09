# Online payments (Stripe, GoCardless, bank transfer)

Decision (docs/DECISION_BRIEFS.md, answered "all three, Stripe default"): advertisers can pay an issued invoice by **Stripe** (default),
**GoCardless**, or **bank transfer**. Recommended defaults were taken for the rules not answered: hosted payment pages only,
money paid into the **issuing franchise's own account**, no surcharges, a credit note before any refund, part and over-payments allocated
as described below.

## How it works

1. **Connect (each franchise, Settings, Connections).** Stripe: Connect OAuth (stores only the franchise's Stripe account id; calls use
   the platform key with `Stripe-Account`). GoCardless: OAuth (the access token is kept in the encrypted secret store). Bank transfer:
   account name, sort code and account number (validated digits), shown with the invoice number as the reference.
2. **Pay.** An advertiser sees **Pay** buttons on each invoice in their portal (only for what the franchise has connected), plus the bank
   details. Staff with `advertiser.payment.request` (franchisee, Head Office; **not** Franchise Staff) create or email a link from
   Finance, Online payments. Card and bank details never touch Raring2go: the payer is sent to the provider's own https page.
3. **One live link per invoice and provider.** The request row is written first; a partial unique index makes a second click reuse the
   first link. A link is replaced (and the old Stripe session expired) when the balance changes. Creating links is rate limited per person.
4. **Outcome by signed webhook only.** Nothing is believed from a redirect back. Stripe: `Stripe-Signature` (HMAC, 5 minute tolerance,
   secret rotation via `STRIPE_WEBHOOK_SECRET_PREVIOUS`). GoCardless: `Webhook-Signature` (HMAC of the body). The signature is checked
   before anything is parsed or looked up; the event is claimed once (`webhook_event_claims`); the payment, its allocation and the
   request's new state are one transaction.

## Rules

| Situation | What happens |
| --- | --- |
| Paid in full | Payment recorded (`online`), allocated, invoice becomes `paid`, request `paid` |
| Part payment | Allocated; invoice `part_paid`; a new link is for the remaining balance |
| Overpayment, or invoice settled another way meanwhile | The excess stays on the payment as **unallocated credit**, listed under Finance, Online payments, for a person to place |
| Delayed methods (bank, Direct Debit) | Money counts only when the provider says it has arrived (`async_payment_succeeded` / `payments.confirmed`) |
| Failed or expired | Request marked; the invoice is free for a new link |
| Refunded or disputed (provider side) | Request marked and shown under "Needs a person"; **nothing is reversed automatically**. Raise a credit note first for a refund; answer a dispute with the provider. Health goes `degraded` (`online_payments`) |
| Event from a different provider account than the link's | Ignored and logged |
| Currency or amount the provider reports is unusable | Not recorded; flagged "needs review" |
| Duplicate or replayed event | Acknowledged and ignored |
| GoCardless payment event before its request is matched | Answered with an error so GoCardless retries (money is never dropped); the amount always comes from GoCardless's own API, not from the event |

## Setup (Head Office, one time)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID` | Platform key and Connect client id (`ca_...`) |
| `STRIPE_WEBHOOK_SECRET` (+ `_PREVIOUS`) | Signing secret of the Connect webhook endpoint pointing at `/api/integrations/stripe/webhook` (events: `checkout.session.completed`, `.async_payment_succeeded`, `.async_payment_failed`, `.expired`, `charge.refunded`, `charge.dispute.created`; listen to **connected accounts**) |
| `GOCARDLESS_CLIENT_ID`, `GOCARDLESS_CLIENT_SECRET`, `GOCARDLESS_REDIRECT_URI` | Partner OAuth app; redirect `https://app.raring2go.co.uk/api/integrations/gocardless/callback` |
| `GOCARDLESS_WEBHOOK_SECRET` (+ `_PREVIOUS`), `GOCARDLESS_ENVIRONMENT` (`sandbox` or `live`) | Webhook endpoint `/api/integrations/gocardless/webhook` |
| `INTEGRATION_SECRET_ENCRYPTION_KEY` | Protects stored GoCardless tokens |
| `APP_URL` | Return addresses after paying |

## Not verified against live accounts

Built from the providers' documented APIs and tested with pretend providers. **Before the pilot, make one real test payment in each provider's test or sandbox mode** (Stripe test mode with a Connect test account; GoCardless sandbox). Points to confirm: Stripe Connect OAuth is the legacy "Standard" flow (your Stripe account may steer you to Account Links); GoCardless's Billing Request links (`payment_request_payment`) and the exact event names are as documented but unseen against a sandbox here.

## Bank transfer

Details are shown to the advertiser with the invoice number as the reference; staff record the receipt with the existing **Record payment** action (the finance assistant suggests matches). There is no automatic bank matching yet.

## Money guards in the database (migration 0054)

Amounts must be positive, status and provider come from fixed lists, and a `paid` request must carry its paid time and the provider's payment reference. Duplicate provider payments are impossible by the existing unique index on provider and event id.

## Tests

`packages/integrations/src/payments.test.ts` (request shapes, signatures, event translation), `apps/web/lib/payments-runtime.test.ts` (Postgres: one live link, replacement, access control, exactly-once recording, part/over/settled, guards, failure/refund/dispute, GoCardless end to end, atomicity, rate limit). The provider failure drill includes these scenarios.

# SignWell e-signature

Chosen as the cheapest realistic option (pay-as-you-go API, free monthly allowance; confirm current pricing and UK terms
with SignWell and your solicitor). It plugs into the provider-neutral e-signature design in `docs/ESIGN_PROVIDER_CONTRACT.md`:
sending uses a SignWell adapter; SignWell's callbacks are translated into the neutral events the platform already applies safely.

## Sending

Sending an approved agreement for signature (Franchisee 360) renders the agreement text to a plain A4 PDF (`apps/web/lib/agreement-pdf.ts`:
title, body and optional headed sections; typographic punctuation is kept as plain equivalents and any symbol outside Latin-1 becomes `?`)
and creates a SignWell document with:

- recipients in signing order (franchisee, then Head Office), `apply_signing_order`, `allow_reassign: false`, `allow_decline: true`;
- `with_signature_page: true`, so SignWell appends a signature page and no field placement is needed;
- 30 day expiry, SignWell's reminders (days 3, 6, 10), and our `agreement_id` in the document metadata;
- **test mode on unless `SIGNWELL_TEST_MODE=false`**: test documents are watermarked and not legally binding. Production config check warns until it is turned off.

The SignWell document id is stored as the signature request's provider id. **Resend** sends a SignWell reminder; **Cancel** deletes the document (which also cancels signing in progress).

## Receiving (the part that needs care)

`POST /api/integrations/signwell/webhook`. SignWell's event hash is an HMAC of only `<type>@<time>` keyed by the webhook id, so it proves the
type and time came from SignWell but **does not protect the body** (document id, signer). So:

1. The hash is verified first (rotation supported with `SIGNWELL_WEBHOOK_ID_PREVIOUS`); events older than 3 days are refused.
2. Nothing in the body is believed: the platform **fetches the document from the SignWell API** and requires its own status to agree
   (`Completed` for completion, `Declined`, `Expired`, `Canceled`) and its recipients to include the signer. A completion event while the
   document is still open is answered with an error so SignWell retries; any other disagreement is ignored.
3. The document must be one we sent, for the agreement named in its metadata.
4. A completed document means everyone has signed, so any signer we did not hear about is recorded in order, then the signed PDF
   (without audit page) and the completion certificate (the audit page version) are fetched from the SignWell address, from the allowed host only,
   checked as a PDF, virus scanned and stored, and the agreement is executed once (existing guarantees: claimed once, locked artefacts, vault adoption).

Status codes: 401 bad hash or too old; 400 malformed; 422 documents refused; 500 passing fault or not yet completed (SignWell retries); 200/202 processed, duplicate or not for us.

## Setup (Head Office, one time)

1. Create a SignWell account and API key. Set `SIGNWELL_API_KEY`. Leave test mode on until the end-to-end test below passes, then set `SIGNWELL_TEST_MODE=false`.
2. Register the webhook (once), then set the id it returns as `SIGNWELL_WEBHOOK_ID`:
   ```bash
   curl -X POST https://www.signwell.com/api/v1/hooks -H "X-Api-Key: $SIGNWELL_API_KEY" -H "Content-Type: application/json" \
     -d '{"callback_url":"https://app.raring2go.co.uk/api/integrations/signwell/webhook"}'
   ```
3. Set `ESIGN_WEBHOOK_SECRET` (any strong random value, used between the translator and the neutral handler) and `ESIGN_ARTIFACT_HOSTS=www.signwell.com`.
4. **Run one full agreement in test mode** (send, sign both signers, check the executed agreement and both stored documents). If the completed PDF addresses
   redirect to another host, add that host to `ESIGN_ARTIFACT_HOSTS` (redirects themselves are refused by design).

## Advertiser proposal acceptance (ADV-005)

When SignWell is configured, an advertiser who chooses **Accept and sign** in the portal signs the proposal with SignWell too (switch off with
`SIGNWELL_ADVERTISER_ACCEPTANCE=off`, which restores the simple "Accept and book"):

1. The acceptance is held as `pending_signature` (the proposal and its slots are untouched), a one-page-plus PDF (who, what, the total, valid-until date and the
   approved terms) is sent to the advertiser's linked contact, and the advertiser is sent straight to SignWell's own signing page (only an https `signwell.com` address is ever followed).
   Choosing Accept again resumes the same document.
2. Only when SignWell's API confirms the document `Completed` is the booking made (reservations, production requests, artwork request), the acceptance becomes final (and immutable), and the
   signed copy with SignWell's audit page is scanned and filed under the issuing franchise.
3. **Declined** by the signer is the advertiser's answer (`rejected`). **Expired, cancelled, could not be sent** lapses the acceptance (`signature_lapsed`) so the advertiser can try again.
4. If the advertiser signs but the booking can no longer be made (the proposal expired, or a slot was taken), the signed copy is kept, the acceptance is lapsed and flagged **needs follow-up**, and health goes
   `degraded` (`advertiser_signatures`): someone must call the advertiser. Nothing is booked on a signature SignWell has not confirmed.

## Not verified against a live SignWell account

Built from SignWell's published API reference (create document, get document, completed PDF, reminder, delete, webhooks and the event hash) with a pretend SignWell
in tests. Unconfirmed until your test: the exact value of per-recipient status (so signer events are confirmed by recipient email and document status, not recipient status),
what the completed-PDF endpoint answers before completion, and whether the completed PDF address needs a header. Documents are not de-duplicated by SignWell:
if a crash happens between SignWell creating a document and us saving its id, a retry could create a second document (the first can be cancelled in SignWell).

## Tests

`apps/web/lib/advertiser-signing.test.ts` (Postgres: pending acceptance, resume, unconfirmed completion, lapse, unbookable signature, booking once with the signed copy), `packages/integrations/src/signwell.test.ts` (client, hash, events), `apps/web/lib/signwell-runtime.test.ts` (PDF rendering; Postgres: sending, forged/stale/malformed events, unknown documents, signer confirmation and replay, unconfirmed completion, execution once with stored documents, reminder and cancel).

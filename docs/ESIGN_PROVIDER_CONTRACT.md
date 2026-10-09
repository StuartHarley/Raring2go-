# E-signature inbound contract (FRN-003)

SignWell is the first provider (`docs/SIGNWELL.md`); its translator calls this handler in-process after confirming events against SignWell's API.

Endpoint: `POST /api/integrations/esign/webhook`. The domain is provider-neutral; a thin translator for the chosen provider converts its callbacks into this shape and signs them.

## Signature
Header `x-esign-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` using `ESIGN_WEBHOOK_SECRET`. `ESIGN_WEBHOOK_SECRET_PREVIOUS` is also accepted for rotation. Timestamps more than 300 seconds old are refused. Signature is verified before anything else is read. Helper: `signESignBody` in `@raring2go/franchise`.

## Body (max 64KB)
`{ eventId, providerRequestId, type, signerEmail?, artifacts? }`
- `type`: `signer.completed` (needs `signerEmail`; signers must complete in order), `completed`, `declined`, `expired`, `cancelled`.
- `completed` needs `artifacts`: `[{kind: "signed_agreement"|"completion_certificate", url, sha256?}]`, https URLs only.
- `providerRequestId` is matched to the request we sent (development provider: `dev-<agreementId>`).

## Artefact fetching
Only plain https from exact host names in `ESIGN_ARTIFACT_HOSTS` (comma separated; none configured means none allowed). No redirects, credentials or IP literals; 20s timeout; 10MB cap; must be a PDF; checksum verified when sent; scanned and stored before execution.

## Responses
200 processed/duplicate/ignored (unknown request, completion for an already executed agreement); 401 bad/stale signature; 400 malformed event or unknown signer; 422 permanent refusal (untrusted host, not a PDF, checksum mismatch, failed scan); 500 transient fetch failure (nothing is claimed, so the provider's retry is processed).

Delivery is idempotent: each event is claimed once (`provider esign`, `<providerRequestId>:<eventId>`) inside the same transaction as its effects. `franchise.agreement.executed` is emitted exactly once.

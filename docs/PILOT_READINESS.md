# Pilot Readiness Report

Status: PIL-008 complete.

## Executive Verdict

Recommendation: READY FOR INTERNAL UAT.

The platform is close to controlled pilot, but live Meta/Facebook publishing remains unverified until project-owned credentials and a pilot Page are configured. That is AMBER rather than RED because the provider adapter, failure handling, secret boundaries and documentation are in place, and the development provider remains available for non-live validation.

## End-to-End Journeys

### Content Journey

HQ content -> localisation -> edition -> public website -> newsletter/social references -> parent engagement -> analytics.

Status: AMBER.

Evidence:

- Public routes use canonical territory slugs and `@raring2go/public` projections.
- Public visibility uses approved/published publishability rules.
- Digital magazine rendering resolves from publication outputs rather than mutable edition state.
- Newsletter/social references are linked to canonical platform records.
- Parent auth/session supports saved content and For You without granting `/app` access.
- Public analytics events persist with redaction, retention and approved event shapes.
- Meta/Facebook adapter exists, but live Page posting is not verified without credentials.

### Commercial Journey

Lead -> proposal -> booking -> invoice -> artwork -> edition placement -> publication -> proof pack -> renewal.

Status: AMBER.

Evidence:

- Advertiser, booking, fulfilment, proof and renewal foundations exist and link to edition outputs.
- Finance, invoice and payment boundaries are provider-neutral.
- File/storage references now have signed URLs and scan gating.
- Public DTOs do not expose booking IDs, pricing, invoices, fulfilment internals or proof metadata.
- Live storage provider and payment/accounting providers still need pilot configuration before real operations.

## Security and Tenancy

Status: GREEN for implemented foundations.

- Server-side auth/context/permission boundaries remain authoritative.
- Parent users do not gain internal organisation membership or `/app` access by account creation.
- Public projections fail closed for unpublished, draft, expired or inconsistent records.
- Cross-territory and cross-organisation isolation are covered by existing tests across auth, permissions, franchise, publishing, marketing and public packages.
- Provider secrets are not committed and should be supplied through environment/deployment secrets only.

## Privacy and Consent

Status: GREEN for implemented foundations.

- Parent account creation is separate from audience consent.
- Public analytics does not store raw IP or user-agent values in the approved event model.
- Analytics metadata is allowlisted and redacted before persistence.
- Saved content is session-backed and filtered through public publishability.
- No child names, exact dates of birth, school details or unnecessary precise family data were added.

## Provider Failure and Retry

Status: AMBER.

- Email transport is provider-neutral with console, HTTP and SMTP-compatible boundaries.
- Storage supports signed URL and scanner abstractions with download blocked until clean/not-required.
- Meta/Facebook adapter reports missing credentials, auth failure, provider outage and API failure without pretending success.
- Social publish jobs persist failed/retryable state and sanitize provider metadata.
- Live Meta retry/no-duplicate behaviour must be verified with a real Page before controlled pilot.

## Performance and Accessibility

Status: AMBER.

- `next build` passes and all public/app routes compile.
- Public pages are server-rendered/dynamic where appropriate.
- Existing design-system and app-shell checks remain green.
- A formal browser-device accessibility pass for pilot territories should be scheduled before external pilot; no automated browser/a11y suite is yet committed for the complete pilot journeys.

## Observability and Support Readiness

Status: AMBER.

- Audit/event foundations exist across sensitive actions.
- Job states exist for email/social/publishing-style workflows and are visible in My Today/Command Centre patterns.
- Provider errors are represented as recoverable operational state.
- A dedicated operations console, alerting, dead-letter queue and support playbook remain future OPS work before broader rollout.

## Remaining Provider/Stubs Classification

Safe to keep stubbed for internal UAT:

- Development social provider.
- Console email provider.
- Development storage provider.
- Provider-neutral AI test/deterministic adapters where human approval remains required.

Must become real before controlled pilot:

- Meta Facebook Page credentials and live-post verification.
- Production-capable email provider credentials/domain authentication for passwordless and transactional mail.
- Production storage backend and scanner integration for real uploaded files.
- Database backups/restore verification for pilot environment.

Must become real before broader production rollout:

- Payment/accounting provider credentials and reconciliation runbooks.
- Full observability/alerting and dead-letter operations console.
- Formal security review, privacy documentation and support escalation process.
- Provider SLA and token-rotation operational ownership.

## GREEN / AMBER / RED Table

| Area | Status | Notes |
| --- | --- | --- |
| Public publishability | GREEN | Central projection boundary in place. |
| Parent session | GREEN | Real global auth session; no internal access leakage. |
| Analytics persistence | GREEN | Privacy-aware table and ingestion path implemented. |
| Email transport | AMBER | Adapter ready; real provider/domain credentials still required. |
| Storage/scanning | AMBER | Signed/scanning boundary ready; real backend/scanner still required. |
| Meta/Facebook publishing | AMBER | Adapter ready; live Page credentials and live-post verification outstanding. |
| Website publishing strategy | GREEN | Next.js canonical; WordPress not active. |
| Tenancy/security | GREEN | Existing automated isolation tests remain green. |
| Privacy/consent | GREEN | Account, consent, preferences and analytics remain separate. |
| Observability/support | AMBER | Foundations exist; full ops console/runbooks remain before broader rollout. |
| Accessibility/performance | AMBER | Build passes; formal device/a11y pilot pass still required. |

## Pilot Blockers

No RED blockers were found for internal UAT.

Controlled pilot blockers to clear:

- Configure real Meta Facebook Page environment variables and complete one live-post verification.
- Configure real email provider credentials and domain authentication.
- Configure real storage/scanner backend for any pilot file uploads.
- Confirm backup/restore and support runbook ownership for pilot environment.

## Final Recommendation

READY FOR INTERNAL UAT.

Move to controlled pilot only after the AMBER provider configuration items are verified with real credentials in the chosen pilot environment.

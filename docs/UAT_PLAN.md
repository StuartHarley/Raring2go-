# UAT and Controlled Pilot Preparation Plan

Status: planning only. Feature development is paused.

This plan follows the PIL-008 recommendation of **READY FOR INTERNAL UAT** and defines the work required to move from internal UAT to a controlled pilot. It does not introduce new product features.

## Objectives

The UAT/pilot phase has five outcomes:

1. Configure and prove the real provider dependencies needed for a controlled pilot.
2. Run structured internal UAT with HQ and selected franchise users against the existing end-to-end workflows.
3. Rehearse migration/import of realistic operating data without compromising canonical ownership or tenancy boundaries.
4. Prove operational readiness: backup/restore, support ownership, incident handling, provider failure visibility and runbooks.
5. Make an evidence-based go/no-go decision for a controlled pilot using a GREEN/AMBER/RED model.

The current platform remains feature-frozen during this phase except for defect fixes required to meet UAT or pilot acceptance criteria.

## UAT-001 — Real Provider Configuration

### Provider setup checklist

The following items are required before controlled pilot unless explicitly accepted as an AMBER workaround.

#### Meta / Facebook Page

- [ ] Confirm the pilot Facebook Page and responsible business/admin owner.
- [ ] Confirm or create the Meta developer app used for Page publishing.
- [ ] Confirm current Meta permissions/review requirements for the Page publishing capabilities used by the adapter.
- [ ] Configure `SOCIAL_PROVIDER=meta-facebook-page` in the pilot environment.
- [ ] Configure `META_FACEBOOK_PAGE_ID` in deployment secrets.
- [ ] Configure `META_FACEBOOK_PAGE_ACCESS_TOKEN` in deployment secrets.
- [ ] Configure `META_APP_SECRET` if webhooks are enabled.
- [ ] Record token expiry/renewal/rotation owner and procedure.
- [ ] Confirm secrets never appear in normal domain records, logs or audit metadata.
- [ ] Complete the controlled live-post test below.

### Meta live-post test

Use one non-sensitive approved content variant and the agreed pilot Page.

1. Confirm the pilot environment is configured with the real Meta provider and secrets.
2. Select an approved Facebook content variant through the normal Content Studio/Social workflow.
3. Queue and approve the publication.
4. Schedule or trigger the durable publish job through the existing workflow.
5. Confirm the Facebook Page post exists and matches the immutable publication snapshot.
6. Confirm the internal social publication records the external provider reference and reaches `published`.
7. Confirm the result appears in the appropriate Marketing Command/My Today view.
8. Retry the completed job and confirm no duplicate Facebook post is created.
9. Exercise a controlled invalid/revoked-token scenario and confirm the item becomes visible, recoverable failure state without leaking secrets.
10. Record evidence, date, tester, account/Page and outcome in the UAT evidence log.

Pass condition: one genuine post is published through the production adapter, reconciles internally, and retry/failure behaviour is proven.

#### Real email and domain setup

The platform remains authoritative for audience, consent, suppression, campaigns, newsletter versions, journeys and delivery history. The email provider remains transport only.

- [ ] Select/approve the production-capable email transport already supported by the integration boundary.
- [ ] Configure sender domain/subdomain for the pilot.
- [ ] Complete provider-required DNS authentication such as SPF/DKIM and any recommended DMARC configuration.
- [ ] Configure pilot sender identities and reply-to ownership.
- [ ] Store credentials only in local/deployment secrets, never Git.
- [ ] Prove passwordless/service email delivery.
- [ ] Prove a controlled test send.
- [ ] Prove one controlled territory newsletter send to an approved small recipient list.
- [ ] Verify suppression before send.
- [ ] Verify bounce/complaint handling and idempotent provider event reconciliation.
- [ ] Confirm a provider event cannot re-enable an internally suppressed contact.
- [ ] Record provider credential/token rotation owner.

Pass condition: passwordless/service mail and one controlled newsletter send use the real provider, delivery state reconciles correctly, and suppression/bounce behaviour is proven.

#### Real storage and scanning setup

The platform must continue to use the provider-neutral `@raring2go/storage` boundary and private-by-default object access.

- [ ] Select/approve the production storage backend for pilot.
- [ ] Configure provider credentials through deployment secrets.
- [ ] Confirm no public bucket/container/object access by default.
- [ ] Prove authorised upload intent and upload.
- [ ] Prove server-authorised short-lived download/signed URL flow.
- [ ] Prove cross-territory/cross-advertiser file access is rejected.
- [ ] Configure the approved malware/security scanning service or production scanning boundary.
- [ ] Prove `pending -> clean -> usable` flow.
- [ ] Prove suspicious/rejected files do not become usable.
- [ ] Prove scanner/provider failure remains visible and recoverable.
- [ ] Exercise real file paths for at least franchise document, advertiser artwork/proof and publishing/content artefact use cases.
- [ ] Document object retention, archive/delete and recovery ownership.

Pass condition: real private upload/download and scan gating work through existing permissions with no public bypass.

## UAT-002 — Internal User Acceptance Testing

### Participants and roles

Use a small, named internal cohort with clear responsibilities. Exact people can be assigned before the session; the role coverage should include:

- **UAT Lead / Product Owner** — owns scenario acceptance and go/no-go evidence.
- **HQ Operations tester** — franchise, agreement, compliance and onboarding journeys.
- **HQ Editorial/Publishing tester** — Content Studio, Edition Factory, templates, publication outputs and Control Room.
- **HQ Commercial/Finance tester** — advertiser pipeline, proposals/bookings, invoicing, artwork, fulfilment, proof and renewals.
- **HQ Marketing tester** — audience, newsletters, journeys, social, analytics and Marketing Command.
- **Franchise owner/editor tester — Territory A** — local operations, local content, edition and commercial activity.
- **Franchise owner/editor tester — Territory B** — second-territory isolation and genericity proof.
- **Parent/public tester** — anonymous discovery, parent sign-in, saved content, preferences, consent and For You.
- **Technical observer/support owner** — records provider/job failures, logs, correlation references and reproducibility.

Do not grant testers broader access merely for convenience. UAT must use permissions representative of the intended pilot roles.

### Scripted UAT journeys

#### Journey A — HQ franchise lifecycle

Agreement generation -> internal approval -> e-sign execution -> compliance evidence/status -> onboarding programme -> blockers/tasks -> launch readiness.

Evidence to capture:

- state transitions and permission boundaries;
- audit timeline;
- document/storage access where configured;
- cross-territory denial;
- My Today/exception links resolving to the exact source record.

#### Journey B — Franchise user lifecycle

Sign in -> own Franchisee 360 -> required compliance/action -> onboarding task -> local content/edition action -> verify inability to access another territory.

Evidence to capture:

- own-territory usability;
- mobile usability for action completion;
- invalid direct URL/ID access denied;
- clear error/empty states.

#### Journey C — Commercial advertiser lifecycle

Lead/opportunity -> proposal -> advertiser acceptance -> booking -> inventory reservation -> invoice/payment state -> artwork -> preflight -> edition placement -> publication -> fulfilment -> Proof Pack -> renewal.

Evidence to capture:

- no rekeying between stages;
- inventory not double-booked;
- issued finance history remains immutable;
- artwork/publishing references remain canonical;
- proof evidence points to actual publication evidence;
- advertiser/territory isolation.

#### Journey D — Editorial/content lifecycle

Canonical content -> HQ network distribution -> territory localisation -> magazine variant -> edition placement -> website public state -> newsletter inclusion -> social queue -> social publication.

Evidence to capture:

- master/local override behaviour;
- AI content remains approval-gated;
- public projections honour publishability;
- newsletter/social variants retain canonical links;
- public site shows only released records.

#### Journey E — HQ edition production

Season/master -> territory editions -> template/layout -> local exceptions -> preflight -> safe fixer result -> print/digital outputs -> public magazine -> Control Room.

Evidence to capture:

- one `territory_edition` remains authoritative;
- originals preserved during fixes;
- final output requires correct approval/preflight;
- published digital output is immutable snapshot-based;
- HQ can identify blockers without opening every edition.

#### Journey F — Parent/public

Anonymous territory discovery -> What's On/content -> digital magazine -> sign in -> save content -> set preferences -> newsletter consent -> For You -> engagement analytics event.

Evidence to capture:

- anonymous browsing remains open;
- parent account cannot access `/app`;
- account creation does not imply marketing consent;
- unpublished/expired saved content stays hidden;
- privacy-safe analytics references.

#### Journey G — Marketing operations

Approved content -> channel variants -> newsletter factory -> controlled email send -> social publication -> journey/automation state -> analytics -> Marketing Command exception/resolution.

Evidence to capture:

- consent/suppression enforced;
- provider retries idempotent;
- failed jobs visible and recoverable;
- no invented analytics.

### UAT evidence

Each scenario should record:

- scenario ID;
- tester;
- environment;
- role/context;
- test data references;
- expected result;
- actual result;
- pass/fail;
- screenshots or artefact references where useful;
- defect IDs;
- date/time;
- retest result.

## Defect Severity and Triage

### Severity model

**S0 — Critical / Stop testing**

Examples: confirmed cross-tenant/private data exposure, destructive data corruption, secrets exposed, legal/financial history mutated incorrectly, uncontrolled bulk send/publish, or unrecoverable platform outage.

Response: stop affected UAT immediately, contain access/integration, notify Product Owner and Technical Owner, and do not proceed toward pilot until fixed and independently retested.

**S1 — Pilot blocker**

Examples: core end-to-end journey cannot complete; auth/login unavailable; published content path broken; real storage/email/social pilot path unusable; backup/restore cannot be proven; severe finance/publication integrity defect.

Response: fix before controlled pilot. Retest full affected journey, not only the individual screen.

**S2 — Major / workaround possible**

Examples: important workflow friction, incorrect exception surfacing, significant mobile/accessibility issue, recoverable provider failure with poor UX, material reporting discrepancy with source records.

Response: Product Owner decides whether workaround is acceptable for a small controlled pilot. Must have named owner, workaround and target fix date.

**S3 — Minor**

Examples: wording, spacing, non-blocking visual inconsistency, low-impact convenience issue.

Response: backlog for post-pilot unless clustered issues materially harm usability.

### Triage rules

- Run triage at least daily during active UAT.
- Security/privacy/tenancy issues override normal severity and are handled immediately.
- Do not downgrade a defect because only one tester encountered it if the impact is high.
- Every S0/S1 fix requires explicit retest evidence.
- Regressions introduced by a fix inherit at least the severity of the broken acceptance path until assessed.
- Feature requests are not defects; record separately and do not expand scope during UAT unless essential for pilot safety.

## UAT-003 — Data Migration / Import Rehearsal

The goal is to prove that representative real-world data can enter the platform without creating duplicate canonical records or bypassing permissions/consent rules.

### Rehearsal datasets

Use anonymised or approved representative samples for:

- franchise/territory records and key contacts;
- advertiser accounts/contacts/opportunities where required;
- current edition/content references;
- audience/newsletter contacts with consent/suppression provenance;
- relevant agreement/compliance/document metadata where appropriate.

### Rehearsal rules

- [ ] Define source owner and source-of-truth decision for each dataset.
- [ ] Map source fields to canonical platform entities before importing.
- [ ] Normalise/dedupe identity by approved rules; do not create duplicate user/audience identities for convenience.
- [ ] Preserve consent source/history; never manufacture consent.
- [ ] Preserve territory/organisation ownership and prove imported records remain scoped.
- [ ] Use dry-run/preview where available before writes.
- [ ] Record rejects and unresolved mappings rather than silently coercing data.
- [ ] Re-run the import/rehearsal safely where idempotency is expected.
- [ ] Validate counts and spot-check records against the source.
- [ ] Document rollback/cleanup procedure for rehearsal data.

Pass condition: agreed pilot datasets can be loaded reproducibly with reconciled counts, no unapproved duplicate identities and no tenancy/consent regression.

## UAT-004 — Operational Readiness

### Backup / restore proof

Controlled pilot cannot be GREEN until backup and restore are demonstrated, not merely configured.

- [ ] Name the person/team accountable for database backup policy.
- [ ] Document frequency, retention and encryption requirements for pilot backups.
- [ ] Confirm automated backup execution in the chosen pilot environment.
- [ ] Restore a backup into an isolated environment.
- [ ] Verify representative franchise, advertiser, publishing, audience and audit records after restore.
- [ ] Record restore duration and any manual steps.
- [ ] Document recovery point/recovery time expectations for the pilot.
- [ ] Define storage/object backup/versioning/retention behaviour for uploaded artefacts.
- [ ] Record evidence and date of successful restore rehearsal.

### Provider failure drills

Exercise and document recovery for:

- email provider unavailable or rejects request;
- Meta token invalid/revoked;
- storage backend unavailable;
- malware scanner fails;
- webhook replay/duplicate event;
- analytics intake failure;
- job retry exhaustion where modelled.

Expected behaviour: no silent data loss, no duplicate consequential action, and an operator can locate the failed record/job and understand the next step.

### Support and runbook ownership

Assign named ownership before controlled pilot for:

- Product/UAT decision owner;
- technical incident owner;
- database/backup owner;
- email/domain owner;
- Meta/social token owner;
- storage/scanning owner;
- support inbox/front-line owner;
- franchise communications owner;
- data/privacy escalation owner.

The pilot runbook should contain:

- environment and deployment overview;
- provider configuration references without secrets;
- database migration procedure;
- backup/restore procedure;
- session/user revocation procedure;
- failed email/social/storage/job diagnosis;
- retry guidance and idempotency cautions;
- emergency disable/feature-toggle guidance where available;
- escalation contacts/ownership;
- known pilot limitations/workarounds.

### Performance and accessibility check

Before sign-off, manually verify the critical journeys at representative mobile, tablet and desktop widths, with particular attention to:

- public territory homepage and What's On;
- parent sign-in/saved/preferences;
- My Today;
- Franchisee 360 and onboarding/compliance actions;
- Advertiser 360/follow-up;
- Edition Control Room;
- Content Studio/social review.

Critical keyboard/focus/form/status accessibility defects are triaged through the normal severity model.

## UAT-005 — Controlled Pilot Sign-off

### GREEN / AMBER / RED readiness model

**GREEN — ready for the controlled pilot**

Acceptance evidence is complete, no S0/S1 defects remain, required real providers are verified, backup/restore is proven, support ownership is assigned and all mandatory security/tenancy journeys pass.

**AMBER — usable only with an explicit controlled workaround**

A known limitation remains but does not compromise security, privacy, legal/financial integrity, consent or recoverability. It has a documented workaround, named owner, risk acceptance and target resolution date.

**RED — blocks controlled pilot**

Any S0/S1 defect, unproven tenancy isolation, unsafe public/private data boundary, missing required provider, inability to authenticate the intended pilot users, uncontrolled consent/suppression behaviour, unproven backup/restore, or inability to safely diagnose/recover from consequential provider/job failures.

### Go / no-go criteria

A **GO — Controlled Pilot** decision requires all of the following:

- [ ] Mandatory HQ, franchise, commercial, editorial, parent and marketing UAT journeys have passed or have only accepted AMBER limitations.
- [ ] No open S0 or S1 defects.
- [ ] Cross-territory, cross-advertiser, parent/internal and public/private isolation checks pass.
- [ ] Meta live-post verification completed if social publishing is included in the pilot scope.
- [ ] Real email/domain setup proven for all email use cases included in pilot scope.
- [ ] Real storage/scanning proven for all file workflows included in pilot scope.
- [ ] Backup and restore rehearsal completed successfully.
- [ ] Support/runbook ownership assigned and the pilot runbook reviewed.
- [ ] Consent and suppression paths verified with real transport configuration.
- [ ] Provider failure drills show recoverable, visible behaviour.
- [ ] Pilot cohort, duration, scope and rollback/escalation criteria agreed.

A **NO-GO** is mandatory if any RED item remains.

### Sign-off record

The final UAT/pilot sign-off should record:

- decision: GO / NO-GO;
- decision date;
- pilot cohort and territories;
- UAT Lead/Product Owner;
- Technical Owner;
- open AMBER items and workarounds;
- open S2/S3 defects accepted into pilot;
- all RED items, if any;
- provider verification evidence;
- backup/restore evidence;
- support/runbook owner confirmation;
- next review date.

## Readiness baseline from PIL-008

The starting point for UAT is:

- **GREEN:** public publishability, parent sessions, analytics persistence, Next.js website publishing strategy, tenancy/security foundations, privacy/consent foundations.
- **AMBER:** real email/domain configuration, real storage/scanning backend, live Meta/Facebook verification, observability/support depth, formal device/accessibility pass.
- **Internal UAT:** approved to begin.
- **Controlled pilot:** remains AMBER until the required provider and operational evidence above is completed.

## Scope control

During UAT:

- do not start another epic;
- do not add discretionary product features;
- only implement defect fixes or operational changes required to meet UAT/pilot acceptance;
- preserve existing provider-neutral boundaries, permissions, public projections, consent/suppression rules and immutable financial/legal/publication history.

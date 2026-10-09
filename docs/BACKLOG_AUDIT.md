# Backlog audit and completion plan (2026-10-09)

Every ticket that was not marked complete was checked against its acceptance criterion by reading the code, tests and
docs (nothing was executed). `docs/BACKLOG.md` now carries the result: **Complete** where the criterion is met,
**Partial (what is missing)** otherwise. Many "complete" tickets are complete at the **service layer only**: the domain
logic and its in-memory tests exist, but nothing in the web app calls the mutations. That is the dominant gap.

## Headline findings

1. **The Postgres integration tests do not run in CI.** CI migrates and seeds a database but never sets
   `RUN_DB_TESTS`, and turbo strips the variable. Every `*.integration.test.ts` (auth, permissions, access, security,
   analytics, assistants, DSAR, tenancy matrix, webhooks) is skipped there. Green CI means only the in-memory tests passed.
2. **Staff-side mutations are unwired.** Advertiser CRM (create advertiser, opportunities, proposals, invoices,
   payments, artwork, fulfilment, renewals), social publishing, compliance generation, audience management and parent
   preferences exist in domain packages with tests, but have no server action, runtime wrapper or job. Pages are
   read-only dashboards.
3. **Fixture data in production paths.** `marketing-runtime.ts` (fixture contact and template ids), the preferences page
   (always shows a fixture parent), `franchise-runtime.ts` (development e-sign provider, placeholder signers, fabricated
   signed-PDF keys) and `sitemap.ts` (seed territories, not the database).
4. **Parent self-service does not exist** (EXT-002, MKT-007, PUB-005): no path lets a parent change consent or
   preferences, save, follow or sign up. The one consent test passes because it also suppresses the contact.
5. **Public site links 404** (what's-on and activities detail pages, per-edition and per-article routes) and several
   sections emit nothing (newsletter form, analytics events).
6. **Smaller:** journey frequency caps are stored but never enforced; accounting sync is not wired and the 20% tax rate
   is hard-coded; audit "immutability" is by API only; no E2E or accessibility tests anywhere; no real e-sign adapter.

## Found while building

- `advertising` and `publishing` stamped records with a hard-coded date (2026-08-11) and "closing soon" meant a fixed week in
  August 2026. Both now read the clock; tests pin it with fake timers.

- Draft invoices were all numbered "DRAFT" and the database allows one number per issuer, so a second draft invoice could not be
  saved. Drafts now carry their own id in the number.

- The invoice tax rate was a hard-coded 20% on every line, whatever the product's tax code. Rates now come from
  `advertiser_tax_rates` by code and date (migration 0048 seeds the UK standard, zero and exempt rates); a code with no rate in
  force refuses to invoice.
- The seed script rewound the invoice number counter on every run, which would reissue used numbers. It now sets the counter
  only when the row is first created.
- A proposal could be booked after its valid-until date.
- Two public items with the same title shared one address, so one page was unreachable and the sitemap listed it twice.
- `apps/web/lib/raw-sql-guard.test.ts` now fails if a Date is interpolated into a raw postgres.js template (the analytics bug).

- Booking created production requests but nothing ever created the artwork requirement, so the artwork flow could not start
  from a real booking. Booking now requests the artwork, placed on the slot's edition page.
- Any artwork status could jump to any other (requested straight to production-ready), and production sign-off ignored failed
  preflight and page readiness. Moves are now a defined set, and sign-off needs a passing version, no open production
  exception and a page Edition Factory marks ready.
- A staff proof could be issued with no artwork version behind it, and the advertiser could then "approve" nothing.
- Advertiser status accepted any string the form posted. It is now a closed set, checked in the domain.
- "Fulfilled" was a typed assertion; it now needs a published edition, a generated output and a published page.
- Domain events are keyed `type:entity`, so a second event of the same type for the same record (for example changes requested
  twice on one artwork) is silently dropped. Not changed here; worth a follow-up.

- Scheduling accepted a time in the past or text that is not a date, and a failed post showed as "failed" while it was actually
  queued to retry. A retry now waits 5, 10 then 20 minutes and shows as retrying; only a post out of attempts, or with an
  unrecoverable error such as bad credentials, shows as failed.
- Social domain events were keyed by a running count, so two simultaneous actions on one post could collide. They now carry a
  unique key.

- **The welcome journey never fired for real subscribers.** Only a script called the "subscribe and trigger journeys" path, so
  parents who subscribed through their preferences (or any other route) were never entered. The journey engine now also
  scans for new subscribers, with the same idempotency key as the direct path so nobody is welcomed twice.
- A journey's conditions were stored but never evaluated at entry. They are now, and a contact who does not meet them is not entered.
- Journey frequency caps were stored in several shapes and never read. One shape is now defined and enforced, with a protective
  default (3 emails per 7 days) when a journey sets none; a parent's chosen email frequency is respected for everything except
  a transactional step such as the welcome email.
- Compliance reminders were created but never delivered, and actions only appeared when someone pressed a button.
- The Postgres test suites share one database and the journey engine now scans it for new subscribers, which made suites
  interfere with each other. DB suites now run one at a time (`turbo --concurrency=1`, and web test files serially under
  `RUN_DB_TESTS`); the whole serial run takes about half a minute. Tests that create contacts clean up through
  `deleteAudienceContactsForTests`.

## What only the business can do (not planned as code)

UAT-001 to 005: provider accounts and credentials, named testers and owners, restore rehearsals on the hosted database,
RPO/RTO and retention decisions, the pilot scope and the GO/NO-GO. The ordered checklist is in `docs/UAT_PROVIDER_SETUP.md`
and `docs/PILOT_READINESS.md`. Also needed from you: the contract for the existing content/events GPT services, a payment
provider choice (online payment), an e-sign provider choice, and the lawful-basis decision for importing audience data.

## Plan

One PR per work package, merged in order. Sizes: S under a day, M a few days, L a week or more of work.

| # | Work package | Closes | Size |
|---|---|---|---|
| 0 | **Make tests honest.** Add `RUN_DB_TESTS` to turbo `globalEnv`, set it in CI, run `security:gate` in CI, fix whatever the integration tests then reveal | FND-001 | S |
| 1 ✅ | **Remove fixtures from production paths.** Real contact/template lookup, parent-session preference centre scaffold, database-driven sitemap, franchise signers from real contacts; make dev-only providers fail closed outside development | audit finding 3 | S–M |
| 2 ✅ | **Parent self-service.** Parent-session preference centre (consent, territories, age bands), newsletter signup, save/follow/unsave, consent-withdrawal-removes-eligibility test, analytics emission from pages | EXT-002, MKT-007, PUB-005, PUB-008 | M |
| 3 ✅ | **Public site completion.** Detail routes, per-edition and per-article routes, canonical URLs, Event/Article structured data, visible Sponsored labels, personalisation flag gating | PUB-001 to 004, 006, 007 | M |
| 4 ✅ | **Advertiser CRM staff UI.** *(Part 1 done: advertiser create/edit, contacts, activity, derived metrics, opportunities and stage changes. Part 2 done: server-priced proposals, send, book, invoice, issue, record and apply payments. Part 3 done: artwork requested at booking, guarded sign-off with production exceptions, fulfilment tied to published output, proof packs, renewal engine and prompts.)* Create/edit advertiser, pipeline actions, proposals and booking, invoices and payments, artwork status, fulfilment and renewals; runtime wrappers with audit and Postgres tests | ADV-001 to 008 | L |
| 5 ✅ | **Social publishing wired.** Runtime wrappers, queue/approve/schedule UI, calendar, job handler registered in the worker, retry/failure surfacing | MKT-005 | M |
| 6 ✅ | **Journeys and compliance jobs.** Enforce frequency caps, define the named journeys, move the journey and compliance cron work into the durable job runtime, deliver compliance reminders | MKT-006, FRN-006 | M |
| 7 ✅ | **Audience import (dry-run first).** Import service with dry-run, reject report, idempotency, consent provenance, tenancy checks, rollback; mapping doc; audience management UI | MKT-001, UAT-003 | L |
| 8 ✅ | **Franchise documents and e-sign boundary.** (Done except franchise staff delegation, which is NOT built and needs your decisions on the role and its permissions; and the real provider adapter.) Real upload/download through storage, agreement artefact adoption, provider-neutral e-sign webhook route with idempotency (provider chosen by you); franchise staff delegation | FRN-003, FRN-004 | M |
| 9 ✅ | **Finance wiring.** (Done except the real accounting provider adapter, which is your choice.) Accounting sync adapter wired, tax configuration, database-level payment idempotency, DB-level immutability for issued invoices and acceptances | ADV-005, ADV-006 | M |
| 10 ✅ | **Metrics and command centres.** Churn, package/digital mix and a versioned definitions document; content clicks and attribution; command-centre gaps | ADV-009, MKT-008, MKT-009 | M |
| 11 ✅ | **Foundation hardening.** (Playwright was not added: it needs a browser download. Smoke and axe checks run against the production build with jsdom instead; a real-browser pass remains a manual release step.) Table, drawer, modal and command-palette components with keyboard tests; audit append-only trigger; activity viewer filters; recovery flow; role-by-role page denial tests; CSP `script-src`; Playwright smoke and axe checks on the critical journeys | FND-002, FND-004, IAM-001, IAM-003 | L |
| 12 ✅ | **Pilot operations kit.** (Repo side done; naming owners, running the drills with real providers and the UAT cycle are yours.) Runbook and support playbook, defect log and sign-off templates, health alerting hook, provider failure drill scripts | UAT-002, 004, 005 (repo side) | M |
| 13 | **Online payment and GPT workflows** | ADV-006, AI | blocked on your decisions |

Recommended order: 0, 1, 2, 3 (makes the parent-facing and public product real and removes the loudest gaps), then 4 and 5
(staff workflows), 6 and 7, then 8 to 12. Work package 0 first because every later package leans on integration tests
actually running.

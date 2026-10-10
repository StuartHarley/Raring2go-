# Scope status: where the build stands against the brief

As of 10 October 2026, from the repository (`main`), `docs/BUILD_SPEC.md`, `docs/BACKLOG.md` and `docs/SCREEN_SPECS.md`.

**What the words mean.** *Built* = implemented in the repo with automated tests (typecheck, lint, unit and real-Postgres tests, security gate). *Live-verified* = exercised against the real provider. Almost nothing is live-verified yet, and that gap is the main remaining risk, not missing features.

## In numbers

| | |
| --- | --- |
| Database tables | 151 |
| Staff, parent and public pages | 84 |
| Route handlers (API, webhooks, downloads) | 40 |
| TypeScript lines (incl. tests) | about 110,000 |
| Automated test cases | about 1,300 across 149 test files |
| Backlog tickets | 62 marked Complete, 14 Partial, 5 Amber (provider set-up) |

## By area

| Area (spec phase) | Status | Notes |
| --- | --- | --- |
| Foundation: monorepo, design system, DB, audit, CI, jobs | Built | Audit is append-only in the database; durable job runtime with dead letters; per-request CSP; smoke test in CI. |
| Identity and editable RBAC, role-aware shells | Built | Permissions are data; server-side denial tested role by role; Franchise Staff delegation. Territory linkage not yet proven by a UI journey. |
| Franchise: 360, agreements, e-sign, documents, compliance, onboarding | Built; e-sign live run pending | SignWell sending and confirmed callbacks; documents with real storage and scanning. |
| Advertiser CRM, proposals, billing, portal | Built; payments live run pending | Stripe (default), GoCardless, bank transfer; Xero hand-off; proposal e-sign via SignWell. Opportunity scoring and tasks are built (`ADVERTISER_CRM.md`). Slots are now created from the Edition Factory flatplan. |
| **Edition Factory** | **Built (this week)**; print not yet run on real tooling | Template library, seasons and masters, territory edition generation, lifecycle (submit, approve, publish), flatplan editor, page studio with autosave, page preflight, print (Chromium + Ghostscript PDF/X-1a) and digital output as durable jobs, Control Room with filters and bulk actions. See `EDITION_FACTORY.md` and `EDITION_RENDERING.md`. |
| Audience, native email, newsletters | Built; email live run pending | Postmark adapter and webhook; consent, suppression, newsletter factory. |
| Social | Partial | Facebook pages live in code (queue, approve, schedule, retry, crash handling). Instagram and LinkedIn have no adapter and fail closed. |
| Journeys and automation | Partial | Engine, caps and suppression built; welcome, re-engagement, digital-magazine, school-holiday countdown, weekly local digest and competition follow-up journeys built and startable from the UI. Sponsored campaigns need advertiser campaign events that do not exist. Automation builder built. |
| Public site and parent experience | Built, two gaps | Territory sites, discovery, magazine reader, SEO, parent accounts, and conversion analytics (clicks, saves, confirmed sign-ups, magazine page turns, proof pack evidence; see `ANALYTICS.md`). The homepage layout is HQ-editable with versioning (`WEBSITE_PUBLISHING.md`). |
| Finance, royalties, benchmarks, health score | Built; accounting live run pending | Royalty statements, scorecard, benchmarks, health score, Xero. |
| AI | Built; live model checks pending | Gateway with audit, content GPT and events GPT adapters, repurposing, suggest-only rules. |
| Operations and security | Built; owners and restore rehearsal are yours | Health alerting, runbook, support playbook, provider failure drills, rate limits, tenant-isolation tests. |

## Edition Factory against the spec's tickets

EDT-001 to EDT-008 are all built and now have screens, not just domain functions: before this week nothing could take an edition past draft, there was no template, season or flatplan screen, and "generate" stored a caller-supplied file instead of rendering one.

Gaps inside it, stated plainly:
- No real Chromium or Ghostscript run yet, so no press-grade PDF has been checked in Acrobat Pro or pdfToolbox, and the printer's ICC profile and PDF/X flavour are not agreed.
- Imposition is basic saddle-stitch only (no creep, gripper margin or press-sheet size); crop marks and trim and bleed boxes are built; no text flow between zones or pages; no brand fonts in the render image.
- The studio takes images by https link plus pixel size; it does not yet pick from the upload library.
- Not load-tested at the spec's 80+ editions.
- Pages have not been clicked through in a browser by a person.

## What only you can do

1. Live test-mode runs: SignWell, Xero, Stripe, GoCardless, Postmark, Meta, storage and malware scan.
2. Build and run the render service; check a real PDF; agree the profile with the printer.
3. Name owners in the runbook, set the alert webhook and uptime monitor, rehearse a hosted restore.
4. Run scripted UAT with HQ and franchise users (checklist in `EDITION_FACTORY.md`); the pilot sign-off depends on it.

## Remaining build, in priority order

1. Fix what UAT finds in the Edition Factory screens.
2. Upload-library images in the studio; creep, gripper margin and press-sheet imposition once the printer's spec is known.
3. Instagram and LinkedIn adapters; sponsored-campaign journeys (need advertiser campaign events first).
4. Data rehearsal tooling for franchise, advertiser and publishing imports (UAT-003).

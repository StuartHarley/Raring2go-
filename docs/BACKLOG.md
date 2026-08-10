# Codex-ready Backlog

Each ticket should be implemented as a focused branch/PR. Acceptance criteria are minimums, not optional guidance.

| ID | Ticket | Phase | Acceptance criteria |
|---|---|---|---|
| FND-001 | Bootstrap monorepo and environments - Create Next.js/TypeScript repo, shared packages, lint/test/typecheck, env validation and preview deployment. | Foundation | Repo builds cleanly; CI runs; preview environment works; secrets are not committed. |
| FND-002 | Create Raring2go design system - Tokens, typography, spacing, status chips, cards, tables, drawers, modals, command palette and accessible forms. | Foundation | Core components documented; keyboard usable; responsive; brand tokens centralised. |
| FND-003 | Database and migrations - Create PostgreSQL connection, migration tooling, seed framework and audit timestamps. | Foundation | Fresh database can migrate and seed deterministically. |
| FND-004 | Audit/event infrastructure - Record create/update/delete/approve/publish/sign/send events with actor and scope. | Foundation | Sensitive actions create immutable audit entries viewable by authorised admins. |
| IAM-001 | Authentication and organisations - Implement login, account recovery, organisation membership and territory linkage. | Identity | Users can belong to correct organisation(s); unauthorised cross-tenant access blocked. |
| IAM-002 | Editable RBAC engine - Policy-driven module/action/scope permissions stored as data. | Identity | Super Admin can change permission without deploy; API and UI enforce same rule. |
| IAM-003 | Role-aware app shells - Navigation and routes adapt to Parent, Advertiser, Franchise Staff, Franchisee, HQ, Super Admin. | Identity | Hidden routes are protected server-side, not just hidden in UI. |
| IAM-004 | Real authentication entry and session plumbing - Replace fixture app-shell sessions with provider-neutral passwordless sign-in, real session cookies, invitation entry and context selection. | Identity | Users can sign in through the real auth boundary; fixture sessions are dev/test gated; protected app routes use validated real sessions. |
| FRN-001 | Franchisee 360 core - Create franchise, territory, ownership, contacts, dates, status and documents summary. | Franchise | HQ can create/edit; franchisee sees allowed own record only. |
| FRN-002 | Agreement generation lifecycle - Generate agreement from approved version with controlled merge fields and approval state. | Franchise | Generated copy stores template/version/variables and cannot skip required internal approval. |
| FRN-003 | E-sign provider abstraction - Support configurable signer order, webhooks, reminders, completion certificate and signed file vault. | Franchise | Completed signing locks signed PDF and triggers onboarding exactly once. |
| FRN-004 | Insurance and compliance - Policy records, expiries, evidence, configurable compliance checklist and alerts. | Franchise | Expiry updates compliance state and creates escalation according to rule. |
| FRN-005 | Onboarding workflow - Milestones from signed agreement to launch with tasks, dependencies, training and first edition readiness. | Franchise | Signing creates onboarding plan; users see progress and blockers. |
| CRM-001 | Advertiser 360 and contacts - Advertiser organisations, contacts, territory ownership, history, notes and relationship state. | Commercial | Duplicate handling; scoped access; complete activity timeline. |
| CRM-002 | Opportunity pipeline - Stages, values, package interest, next action, scoring and tasks. | Commercial | Stage changes audited; dashboard counts reconcile to opportunities. |
| CRM-003 | Products, packages and inventory - Print/digital/combined catalogue, territory pricing and edition/digital availability. | Commercial | Cannot oversell inventory; pricing and discount permissions enforced. |
| CRM-004 | Proposal and booking - Generate proposal, advertiser acceptance/e-sign and campaign booking. | Commercial | Accepted booking creates campaign and downstream tasks once. |
| FIN-001 | Advertiser invoicing - Create invoice from booking, lines, taxes/config, payment terms and PDF. | Finance | Invoice totals reconcile to booked items; status state machine tested. |
| FIN-002 | Payments and reconciliation - Card/DD/manual payment records, allocations, webhook idempotency and accounting sync interface. | Finance | Duplicate webhook does not duplicate payment; balance correct. |
| PUB-001 | Season and master edition model - Create seasonal master, territory editions, issue dates, inherited pages and deadlines. | Publishing | One master can generate selected territories with traceable inheritance. |
| PUB-002 | Magazine template library - HQ cover/internal template CRUD, versions, locked elements and editable zones. | Publishing | Published template immutable; new revision creates new version. |
| PUB-003 | Edition flatplan - Visual page/spread ordering, status, assignments, adverts and template selection. | Publishing | Drag reorder persists; permissions respected; page readiness visible. |
| PUB-004 | Page/content studio - Structured content zones, autosave, assets, comments, previews and local overrides. | Publishing | Locked zones cannot be edited by local role; version history retained. |
| PUB-005 | Asset preflight and safe fixer - Check resolution, dimensions, bleed, colour, file type and compatibility; safe corrected copy. | Publishing | Original preserved; fixes are explicit; unfixable issue becomes task. |
| PUB-006 | Print output pipeline - Generate review and press-ready PDF, final preflight, approval and archive. | Publishing | Only approved edition can create final locked output; job is retry-safe. |
| PUB-007 | Digital magazine output - Create digital edition from same pages with links, metadata and tracking. | Publishing | Digital and print share edition/page IDs; no separate manual rebuild. |
| PUB-008 | Edition Control Room - Network grid for 80+ editions, readiness, exceptions, filters and bulk operations. | Publishing | HQ can identify all blocking exceptions without opening each edition. |
| PUB-009 | Inheritance correction propagation - Propagate updated HQ master content to inherited instances while preserving local overrides. | Publishing | Only inherited/non-overridden instances update; audit shows propagation result. |
| AI-001 | AI service gateway - Common interface for editorial, events, localisation, copy-fit and future agents with audit/source metadata. | AI | Every run stores actor, purpose, inputs references, model/service, output and approval state. |
| AI-002 | Wire existing content GPT workflow - Expose current content creation workflow inside Content Studio through service adapter. | AI | User can invoke from content record and accept/reject result without copy/paste. |
| AI-003 | Wire events-finding GPT workflow - Territory/date-aware event discovery queue with dedupe and approval. | AI | Suggestions store source URL/context and never publish without configured approval. |
| AI-004 | Content repurposing - Approved article produces web, newsletter and social variants and queues. | AI | Variants link to source content and preserve approval/audit status. |
| AUD-001 | Audience profile and consent - Unified audience record, consent history, territory assignment and preference centre. | Audience | Unsubscribe/suppression enforced for all sends; history retained. |
| AUD-002 | Segmentation engine - Saved/query segments by territory, consent, interests, source and engagement. | Audience | Preview returns only eligible contacts and shows exclusions. |
| EML-001 | Native email templates and builder - Block-based branded builder, locked header/footer/legal modules, preview and tests. | Email | Franchisee cannot remove mandatory compliance blocks. |
| EML-002 | Central Newsletter Factory - HQ master newsletter generates territory variants with dynamic local content. | Email | Batch preview shows all territories and missing-content exceptions. |
| EML-003 | Email delivery adapter - Provider-agnostic sending API, webhooks, bounces, complaints, suppressions and tracking. | Email | Delivery events reconcile; suppression happens immediately. |
| EML-004 | Franchisee local sends - Permission-controlled local campaigns to authorised audience segments. | Email | Audience and send permissions enforced server-side with optional HQ approval. |
| ROY-001 | Royalty rules and statements - Rules from agreement/fee schedule, calculation, exceptions, approvals and franchisee statement. | Finance | Statement reproducible from source transactions and auditable adjustments. |
| ANL-001 | Business-in-a-Box scorecard - Commercial, audience, publishing, franchise, finance and operations metrics. | Analytics | Metric definitions documented and consistent across HQ/territory views. |
| ANL-002 | Benchmarking and health score - Peer benchmarks and configurable Franchise Health Score. | Analytics | No confidential peer detail exposed; factors and snapshot version auditable. |
| AUT-001 | Workflow engine MVP - Event, condition, action, approval and retry model for core lifecycle triggers. | Automation | Agreement signed, booking, overdue invoice and newsletter approval workflows run idempotently. |
| AUT-002 | Automation builder UI - Super Admin can view/edit enabled workflow definitions and thresholds. | Automation | Changes versioned; draft can be tested before activation. |
| EXT-001 | Advertiser portal - Advertiser campaign booking, uploads, proofs, invoices/payment, reporting and renewals. | External | Advertiser sees own organisation only and complete current campaign state. |
| EXT-002 | Parent account - Preferences, saved content, subscriptions and local engagement. | External | Consent updates immediately affect eligible email audience. |
| OPS-001 | Observability and job console - Structured logs, job state, retries, dead-letter/exception visibility and system health. | Operations | Admins can trace failed publication/email/AI job to record and retry safely. |
| SEC-001 | Security and data protection baseline - Tenant isolation tests, rate limits, secure file access, secrets, backups, retention and export/deletion workflows. | Security | Automated tests prove cross-territory isolation; security checklist blocks release. |

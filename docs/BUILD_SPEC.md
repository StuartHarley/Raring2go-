# Raring2go! Business-in-a-Box - Codex Build Specification

Version 1.0 | Derived from Product Architecture v1.2

## Product objective
Build one premium Raring2go! operating system that connects franchise management, advertiser sales, edition production, parent audience, native email, finance, royalties, analytics and AI-assisted automation. A franchisee should have one login and one prioritised action list; Head Office should manage the network by exception.

## Non-negotiable product rules
1. One source of truth for shared records; avoid duplicate campaign/content/edition records across modules.
2. Role and territory permissions are data-driven, editable and enforced on the server.
3. One territory edition produces both print and digital magazine outputs.
4. HQ controls magazine templates and locked brand/production elements; local users fill permitted zones.
5. Shared content is inherited; local overrides are protected; master corrections propagate only where safe.
6. Native newsletter/email UX belongs inside Raring2go!, even if delivery uses a specialist API beneath it.
7. AI is contextual and auditable; judgement-sensitive legal, financial, compliance and publishing actions require configured human approval.
8. Long-running work is queued, idempotent, retryable and visible.
9. Every consequential approval, publish, sign, send, financial adjustment and permission change creates an audit event.
10. The first production milestone is an end-to-end territory vertical slice, not dozens of half-built modules.

## Recommended implementation architecture
- Next.js App Router + TypeScript for the main application.
- Server Components by default; Client Components only for interactive workspaces.
- Node.js runtime by default.
- PostgreSQL as transactional source of truth.
- Shared typed data-access package with migrations and seed data.
- Object storage for artwork, agreements, proofs, generated PDFs and edition archives.
- Background job/workflow layer for PDF generation, file preflight, AI, email and bulk edition work.
- API/webhook boundary for payments, accounting, e-sign, bulk-email delivery, public website and AI services.
- Central audit/event model and feature flags.
- Analytics aggregates separated from transactional writes.

## Suggested monorepo
```text
raring2go/
  AGENTS.md
  README.md
  apps/
    web/                    # Next.js application
  packages/
    ui/                     # Raring2go design system
    db/                     # schema, migrations, queries, seeds
    auth/                   # identity/session helpers
    permissions/            # RBAC/policy evaluation
    audit/                  # audit/event helpers
    workflows/              # workflow definitions/execution
    ai/                     # AI gateway + service adapters
    publishing/             # edition/template/output domain logic
    email/                  # audience/send/domain logic
    finance/                # invoices/payments/royalties
    integrations/           # e-sign, accounting, payment, email adapters
    observability/          # logging, tracing, job status
    config/                 # environment/config validation
  docs/
    BUILD_SPEC.md
    RBAC_MATRIX.md
    DATA_MODEL.md
    SCREEN_SPECS.md
    BACKLOG.md
    AI_AUTOMATION.md
    INTEGRATIONS.md
  tests/
    e2e/
    fixtures/
```

## Architecture boundaries
Route handlers and server actions orchestrate authenticated user operations but domain rules live in packages, not UI components. Provider-specific logic stays behind adapters. Publishing, finance and agreement state transitions must be explicit state machines or validated domain functions rather than arbitrary field edits.

## Build sequence
Foundation -> Identity/RBAC -> Franchise/CRM -> Edition vertical slice -> 80+ Edition Factory -> Audience/native email -> Finance/network intelligence -> AI optimisation.

See the companion documents in this pack for the data model, roles, screens and ticket backlog.

# AGENTS.md - Raring2go! Build Rules

## Mission
Build and maintain the Raring2go! Business-in-a-Box platform as a secure, auditable, role-aware franchise and publishing operating system.

## Before changing code
- Read `docs/BUILD_SPEC.md` and the relevant domain document.
- Identify the user role(s), territory scope and approval boundary affected.
- Reuse domain services and design-system components; do not duplicate rules in pages.
- Prefer small, reviewable changes that complete one vertical behaviour.

## Architecture rules
- Use Next.js App Router and TypeScript.
- Server Components are the default. Add `use client` only where browser interaction requires it.
- Keep domain logic out of React components.
- All mutations must perform server-side authorisation. Hiding a button is never security.
- Provider integrations must be adapters/interfaces; provider names must not leak through the domain model unless necessary.
- Long tasks use durable queued jobs/workflows with idempotency keys and visible status.
- Financial, publication, signing and email-send webhooks must be idempotent.
- Never overwrite source assets when applying an automatic fix; store a derived asset version.

## RBAC and tenancy
- Permissions are data-driven: module + action + scope + optional constraints.
- Every query touching franchise/advertiser/audience data must prove organisation/territory scope.
- Add automated cross-tenant access tests for every new sensitive endpoint.
- Super Admin access is highly privileged and audited.

## Publishing invariants
- One `territory_edition` is the authoritative record for print and digital outputs.
- Master content/template inheritance must retain source version and override state.
- HQ master changes must not overwrite local overrides.
- Final print output requires configured approvals and a successful final preflight.
- Published template versions are immutable; changes create a new version.

## AI rules
- Use the common AI gateway; do not call models directly from UI code.
- Store purpose, source record IDs, source/context references, output, actor and approval state for consequential AI runs.
- Existing Raring2go content-creation and events-finding GPT workflows should be integrated through adapters, not copied into UI prompts.
- AI may prepare/suggest; it must not silently make final legal, material finance, sensitive compliance or defined high-risk publishing decisions.
- AI-created public content must follow configured approval policy.

## Quality gate
A ticket is not done until: typecheck + lint + unit tests pass; relevant integration/E2E test exists; permissions are tested; loading/error/empty states exist; audit behaviour is verified; accessibility basics pass; migration/seed impact is documented; acceptance criteria are demonstrably met.

## Do not
- Do not hard-code role names into business rules when a permission/policy can express the rule.
- Do not create a second copy of advertiser/content/edition data for convenience.
- Do not send email directly from a page request for bulk campaigns.
- Do not trust client-supplied territory or organisation IDs without authorisation.
- Do not auto-fix an unfixable low-quality image and claim it is print-safe.

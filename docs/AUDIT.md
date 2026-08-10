# Audit Event Foundation

FND-004 establishes the application audit service in `@raring2go/audit`. It records consequential actions into the existing `audit_events` table and keeps entity references durable through `entity_type` and `entity_id`.

## Event Shape

Audit events store:

- actor user ID when the actor is a human user;
- stable dot-case action name;
- durable entity type and optional entity ID;
- optional organisation and territory scope;
- redacted payload metadata;
- creation timestamp from PostgreSQL.

The payload carries attribution, correlation IDs, request/job IDs, before/after snapshots, field-level changes and additional metadata.

## Attribution

The audit service supports four actor categories:

- `human` for a user changing, approving, signing or sending something;
- `system` for platform-owned maintenance or internal service actions;
- `automation` for workflow/job actions with a run ID where available;
- `ai` for generated or performed AI actions.

AI attribution distinguishes suggestions, human-approved AI output and approved low-risk automated AI actions. High-risk legal, finance, compliance and publishing decisions still require configured human approval in future domain tickets.

## Transaction Behaviour

`recordAuditEvent` receives a database object from the caller. Future domain services can pass the same transaction object used for the business mutation, so the business change and audit write commit or roll back together. The audit service does not open its own connection.

## Redaction

Sensitive payload keys are recursively redacted before insert, including passwords, tokens, secrets, API keys, private keys and payment card fields. Domain packages may add stricter metadata shaping before calling the audit service.

## Immutability

The service exposes insert and list helpers only. Audit events are append-only; updates and deletes are intentionally not part of the package API.

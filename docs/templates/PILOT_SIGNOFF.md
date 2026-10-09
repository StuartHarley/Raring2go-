# Controlled Pilot Sign-off Template (UAT-005)

Complete once UAT-001 to UAT-004 evidence exists in `docs/UAT_EVIDENCE.md`. The decision is GREEN (go), AMBER (go with
named, accepted conditions) or RED (no go). Nothing here is pre-filled: a blank box is not a pass.

## Decision

- Decision: GREEN / AMBER / RED
- Date and time:
- Environment and release (commit or deployment id):
- Pilot start date and review date:

## Scope being signed off

- Territories:
- Franchisee users (names or count) and Head Office users:
- Journeys in scope / explicitly out of scope:
- Providers live in the pilot (email, storage and scanning, social, accounting, e-signature): and which are still development providers:
- Support hours and channel:

## Evidence checklist (link each to `docs/UAT_EVIDENCE.md`)

| Gate | Evidence | Status |
| --- | --- | --- |
| UAT scripts A-G run by named participants, results recorded | | |
| Defect log: no open S0 or S1; every open S2 has owner, workaround, target date, approval | `docs/templates/DEFECT_LOG.md` copy | |
| Security gate and CI green on the release; `pnpm security:config` clean for production variables | | |
| Cross-tenant and role-by-role denial tests green on the release | | |
| Backup restored into an isolated environment, with date, duration, checks | `docs/BACKUP_RESTORE.md` | |
| Provider failure drill output (`pnpm drill:providers`) and live drills run | `docs/PROVIDER_FAILURE_DRILLS.md` | |
| Health alerting tested end to end (alert, reminder, recovery) and an external uptime monitor configured | | |
| Real provider configuration verified: email domain, Meta live-post, storage and scanner | `docs/UAT_PROVIDER_SETUP.md` | |
| Data import rehearsal reviewed (if importing) | `docs/AUDIENCE_IMPORT.md` | |
| Real-browser accessibility pass on the pilot journeys (contrast, keyboard, screen reader) | | |
| Privacy: consent, erasure and retention behaviour reviewed | | |
| Ownership table in `docs/PILOT_RUNBOOK.md` filled in and each owner has confirmed | | |
| Support playbook walked through with the support owner | | |

## Accepted risks and conditions (AMBER only)

| Risk or gap | Why accepted | Owner | Mitigation | Review date |
| --- | --- | --- | --- | --- |
| | | | | |

## Known limitations communicated to pilot users

(Copy from `docs/PILOT_RUNBOOK.md` section 8 and add any others.)

## Stop conditions (agreed in advance)

The pilot pauses immediately for any S0, any cross-territory data exposure, a send or publish that cannot be stopped, or
loss of the ability to restore. Who may call the stop: product owner or technical incident owner.

## Sign-off

| Role | Name | Decision | Date | Signature |
| --- | --- | --- | --- | --- |
| Product / UAT decision owner | | | | |
| Technical incident owner | | | | |
| Data protection owner | | | | |
| Head Office sponsor | | | | |

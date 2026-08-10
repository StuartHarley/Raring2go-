# Codex Task 003 - First Edition Vertical Slice

Read `AGENTS.md`, `docs/BUILD_SPEC.md`, `docs/DATA_MODEL.md`, and `docs/SCREEN_SPECS.md`.

Implement PUB-001 through PUB-007 for ONE realistic seeded territory before building network-scale bulk operations.

The user journey must work end-to-end:
1. HQ creates a season/master edition.
2. HQ creates/publishes a cover or internal page template with locked and editable zones.
3. A territory edition is generated from the master.
4. A local editor uses the Edition Studio and Page/Content Studio to fill permitted zones.
5. Assets are uploaded and preflighted; safe fixes create derived versions while originals remain intact.
6. Required approvals are completed.
7. The system creates a print output and a digital output from the same territory-edition/page records.
8. Audit events and job status make the complete lifecycle traceable.

Do not implement 80+ territory bulk generation yet. Complete the vertical slice, tests and failure states first.

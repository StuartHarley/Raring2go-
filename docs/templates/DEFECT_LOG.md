# Defect Log Template (UAT-002)

Copy this file (or use `defect-log.csv`) for each UAT or pilot cycle. One row per defect. Severity definitions and
triage rules: `docs/UAT_PLAN.md`. Feature requests are not defects: record them in a separate list.

## Rules

- Triage at least daily during active UAT. Security, privacy and tenancy issues are S0 first.
- Only pilot-blocking issues (S0, S1) must be fixed before sign-off. An S2 may go to pilot only with a named owner, a workaround and a target date approved by the product owner.
- Every S0/S1 fix needs retest evidence for the whole affected journey, not only the screen.
- A regression caused by a fix inherits at least the severity of the journey it broke.

## Log

| ID | Date raised | Raised by | Scenario / journey | Environment | Summary | Steps to reproduce | Expected | Actual | Severity (S0-S3) | Area (franchise, commercial, publishing, marketing, parent, platform) | Owner | Workaround | Target date | Status (new, triaged, fixing, retest, closed, accepted) | Retest evidence | Decision and approver |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D-001 | | | | | | | | | | | | | | | | |

## Cycle summary (complete at the end of each cycle)

| Severity | Raised | Fixed and retested | Accepted with workaround | Open |
| --- | --- | --- | --- | --- |
| S0 | | | n/a (must be 0 open) | |
| S1 | | | n/a (must be 0 open) | |
| S2 | | | | |
| S3 | | | | |

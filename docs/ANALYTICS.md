# Analytics: scorecard, benchmarks and Franchise Health Score (ANL-001, ANL-002)

Package: `packages/analytics`. UI: `/app/analytics` (scorecard) and `/app/analytics/health` (scoring rules).

## One definition per metric

Every metric is declared once in `packages/analytics/src/catalogue.ts` with a label, domain, unit, direction
(higher/lower/neutral is better), plain-English description, formula, source tables and time window. The
scorecard renders those same fields under "How this is calculated", so what users read is what is computed.

Territory and network figures come out of the same queries (`collect.ts`):

- Count and sum metrics: the network value is exactly the sum of the territory rows.
- Ratio metrics (overdue share): re-derived from the summed components, never an average of territory ratios.
- No activity means `0` for counts, and "No data" for ratios with nothing to divide.

`DEFINITIONS_VERSION` is stored with every snapshot. Bump it whenever a definition's meaning changes, so a trend
line is never silently stitched across two meanings.

## Who sees what

| Grant | Sees |
| --- | --- |
| `analytics.scorecard.view` at network/system scope (HQ) | Network totals, every territory's score and headline metrics, band distribution |
| `analytics.scorecard.view` at own territory (franchisee) | Own metrics and own score, plus peer **aggregates** only |
| `analytics.health_config.manage` (network) | Create/edit drafts and activate scoring versions |
| `analytics.snapshot.generate` (network) | Generate today's snapshot on demand |

Territory-scoped users receive a different object, not a filtered copy: the service builds the territory view
from that territory's values only. Tests assert no other territory's id, name or value appears anywhere in the payload.

## Peer benchmarks

`benchmark.ts` returns only the network median and quartiles and the viewer's position (top quarter ... bottom
quarter, direction-aware). It is withheld entirely when fewer than `MIN_PEER_COHORT` (5) other territories have data,
so a comparison can never identify an individual peer. Neutral metrics (for example AI spend) are not benchmarked.

## Franchise Health Score

A weighted blend of factors. Each factor maps its raw value to 0-100 linearly between a `bad` and a `good`
anchor (either can be the larger number, for lower-is-better metrics). Weights are relative. Factors with no
data are left out and the remaining weights re-normalised, so missing data is never scored as zero; a territory
with no data at all is "Not rated" and no score is stored. Money anchors are in pence.

Bands come from thresholds (default healthy >= 75, watch >= 50, otherwise at risk).

### Versioning and audit

- `health_score_configs` rows are versioned. Only a **draft** is editable; **active** and **retired** versions are immutable history.
- Activating a draft retires the current active one in one transaction; a database partial unique index guarantees at most one active version, and a concurrent double-activation has exactly one winner.
- The first read installs the built-in default as version 1 (non-destructive, race-safe).
- Audit actions: `analytics.health_config.create`, `.update`, `.activate`, `analytics.snapshot.generate`. Update events keep before/after factors.
- Every stored `franchise_health_snapshots` row records the config id and version plus the full per-factor breakdown (raw value, normalised score, effective weight, points), so any historical score can be explained.

## Snapshots and the job

`analytics.snapshot_metrics` runs once a day from the existing worker tick (idempotency key per day) and writes:

- `metric_snapshots`: one row per territory per day plus one network row, with the definitions version.
- `franchise_health_snapshots`: one row per scored territory per day.

Re-running the same day replaces that day's rows. The job is registered in `buildJobRegistry`, so failures show
in the Job Console and can be retried. "Change vs 30 days ago" on the scorecard reads the latest snapshot on or
before that date; until snapshots have accumulated it simply shows no change figure.

## Migration and seed impact

- Migration `0044_conscious_franklin_storm.sql` adds `metric_snapshots`, `health_score_configs`, `franchise_health_snapshots`. No data migration.
- New permissions (`analytics.scorecard.view`, `analytics.health_config.manage`, `analytics.snapshot.generate`): run `pnpm db:seed` on existing environments to grant them (superadmin, HQ admin; franchisee gets scorecard view for own territory).
- No environment variables.

## Known limits

- Cohort for benchmarking is every non-deleted territory (including non-franchise contexts such as UAT); filter by franchise status if that is not what you want once real data exists.
- Metrics that need external provider data (social reach, ad spend outside the platform) are not in the catalogue until those sources are connected.
- Health scoring thresholds and default anchors are starting points to tune with real network data.

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

## Definitions version history

| Version | Change |
| --- | --- |
| 2026.10.1 | First catalogue (ANL-001). |
| 2026.10.2 | Added advertiser churn and sales mix: `commercial.customer_base_12m_ago`, `commercial.churned_12m`, `commercial.churn_rate_12m`, `commercial.sold_value_90d`, `commercial.package_value_90d`, `commercial.digital_value_90d`, `commercial.package_share_90d`, `commercial.digital_share_90d`. New windows `rolling_90_days` and `rolling_12_months`. |

### Churn and mix (ADV-009)

- **Churn (12 months)** = advertisers who had booked before 12 months ago and had not already lapsed, who have since lapsed (no booking for more than 12 months, per the lapse date derived from booking history), divided by that base. No figure when there was no base.
- **Package share** = sold line value on proposal lines that belong to a commercial package, divided by all sold line value in the last 90 days. **Digital share** = sold line value on products whose channel is not `magazine`, divided by the same total. Archived advertisers are excluded everywhere.
- The HQ commercial command centre computes churn and mix from the same rules (`advertiserChurn`, `commercialMix` in `packages/advertising`), and a database test asserts the command centre and `collectMetrics` agree. The command centre also lists lost-deal reasons.

## Marketing insight (MKT-008, MKT-009)

Derived only from records that exist; a metric with no source is shown as "Not tracked yet" or listed under "Not measured", never as zero or an estimate.

- **Content engagement** (`/app/marketing-analytics`): from `public_analytics_events` over 30 days: area views, content views, content clicks, sponsored clicks, newsletter sign-ups, top content, and visits credited to campaign tags (`utm_source`, read from the landing URL by the public tracker and stored without any personal data). Clicks are recorded by `TrackedLink` on public cards. Impressions are not tracked, so no click-through rate is reported.
- **Command centre extras** (`/app/marketing-command`): send exceptions (failed, overdue-scheduled, or bouncing newsletters), content gaps (no content published in 30 days), top content, advertiser obligations (outstanding artwork and fulfilment, counts only, shown to people who hold advertiser analytics), and optimisation opportunities. Opportunities are rule-based suggestions; nothing is generated or published without a person starting it and approving the result.
- Scope: territory users receive only their territory's rows (tested); the network sees everything.

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

## Public site events (PUB-008)

| Event | Recorded by | When | Entity |
| --- | --- | --- | --- |
| `territory_viewed`, `content_viewed`, `magazine_opened` | browser | a page view | territory / content, advertiser or edition |
| `newsletter_signup_started` | browser | the sign-up form is submitted | newsletter |
| `discovery_item_clicked`, `commercial_placement_clicked` | browser | a tracked link is clicked | content / advertiser |
| `magazine_page_interaction` | browser | previous or next page in the reader is clicked | edition |
| `content_saved` | **server** | a signed-in parent saves public content (a repeat save is not counted again) | content |
| `newsletter_signup_completed` | **server** | the parent presses "email me" and the subscription really changed (a repeat or an unsubscribe is not counted) | newsletter |
| `public_conversion` | **server** | a parent enters a competition (once per entry; `conversionType: competition_entry`) | content |

Privacy: no event stores an IP address, a user agent, a contact, a user or a session. Server-recorded events carry only what happened, where, and to which content. The intake endpoint **refuses** `content_saved`, `newsletter_signup_completed` and `public_conversion`, so a visitor cannot invent saves or sign-ups. A failure to record an event never breaks the action the person took.

Not tracked: impressions (so no click-through rate), email opens and clicks where the provider does not report them, social reach, print reach.

### Proof pack evidence

When a proof pack is created, its metrics are the advertiser's own tracked events in their territory from the day the campaign was fulfilled to now: `businessPageViews` (views of their business page) and `placementClicks` (clicks on their sponsored placement). They are tied to the advertiser's id, never spread across advertisers, and cover this site only. The advertiser sees them in their portal.

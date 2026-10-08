import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

/** Bump when a definition changes meaning, so a stored snapshot can be interpreted later. */
export const DEFINITIONS_VERSION = "2026.10.1";

export type MetricDomain = "commercial" | "audience" | "publishing" | "franchise" | "operations";
export type MetricUnit = "count" | "minor_currency" | "percent";
/** `neutral` metrics are shown but never scored (e.g. spend). */
export type MetricDirection = "higher" | "lower" | "neutral";

export type MetricValues = Record<string, number | null>;

export type QueryContext = { now: Date; since: Date; today: string };

export type MetricDefinition = {
  key: string;
  label: string;
  domain: MetricDomain;
  unit: MetricUnit;
  direction: MetricDirection;
  /** Plain English: what this measures, shown next to the number everywhere it appears. */
  description: string;
  /** The exact rule, for anyone who needs to reconcile it. */
  formula: string;
  source: string;
  window: "current" | "rolling_30_days";
} & (
  | { kind: "query"; query: (context: QueryContext) => SQL }
  | { kind: "derived"; derive: (values: MetricValues) => number | null; components: string[] }
);

/**
 * Every metric the platform reports, defined once. The scorecard, benchmarks and health
 * score all read these definitions and the single collection path in collect.ts, so a
 * territory's number is identical wherever it is shown, and the network figure is always
 * the sum (or re-derivation) of the territories.
 *
 * Queries return rows of (territory_id, value). Soft-deleted rows are always excluded.
 */
export const metricCatalogue: MetricDefinition[] = [
  {
    key: "commercial.bookings_value_30d",
    label: "Bookings value (30 days)",
    domain: "commercial",
    unit: "minor_currency",
    direction: "higher",
    description: "The value of advertising bookings confirmed in the last 30 days.",
    formula: "Sum of booking total value where status is booked and booked on or after 30 days ago.",
    source: "commercial_bookings",
    window: "rolling_30_days",
    kind: "query",
    query: ({ since }) => sql`
      SELECT territory_id, COALESCE(SUM(total_value_minor), 0)::float8 AS value
      FROM commercial_bookings
      WHERE deleted_at IS NULL AND status = 'booked' AND booked_on >= ${since.toISOString().slice(0, 10)}::date
      GROUP BY territory_id`
  },
  {
    key: "commercial.active_advertisers",
    label: "Active advertisers",
    domain: "commercial",
    unit: "count",
    direction: "higher",
    description: "Advertisers currently marked active.",
    formula: "Count of advertisers with status active.",
    source: "advertisers",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT owning_territory_id AS territory_id, COUNT(*)::float8 AS value
      FROM advertisers WHERE deleted_at IS NULL AND status = 'active'
      GROUP BY owning_territory_id`
  },
  {
    key: "commercial.receivables_outstanding",
    label: "Outstanding invoices",
    domain: "commercial",
    unit: "minor_currency",
    direction: "lower",
    description: "Money owed on issued invoices that have not been fully paid.",
    formula: "Sum of balance on invoices with status issued or part paid.",
    source: "advertiser_invoices",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT territory_id, COALESCE(SUM(balance_minor), 0)::float8 AS value
      FROM advertiser_invoices
      WHERE deleted_at IS NULL AND status IN ('issued', 'part_paid')
      GROUP BY territory_id`
  },
  {
    key: "commercial.receivables_overdue",
    label: "Overdue invoices",
    domain: "commercial",
    unit: "minor_currency",
    direction: "lower",
    description: "Outstanding money that is past its due date.",
    formula: "Sum of balance on issued or part-paid invoices whose due date is before today.",
    source: "advertiser_invoices",
    window: "current",
    kind: "query",
    query: ({ today }) => sql`
      SELECT territory_id, COALESCE(SUM(balance_minor), 0)::float8 AS value
      FROM advertiser_invoices
      WHERE deleted_at IS NULL AND status IN ('issued', 'part_paid') AND due_date < ${today}::date
      GROUP BY territory_id`
  },
  {
    key: "commercial.overdue_share",
    label: "Overdue share of invoices",
    domain: "commercial",
    unit: "percent",
    direction: "lower",
    description: "How much of what is owed is overdue. No data when nothing is outstanding.",
    formula: "Overdue invoices divided by outstanding invoices, as a percentage.",
    source: "derived",
    window: "current",
    kind: "derived",
    components: ["commercial.receivables_overdue", "commercial.receivables_outstanding"],
    derive: (values) => {
      const outstanding = values["commercial.receivables_outstanding"];
      const overdue = values["commercial.receivables_overdue"];
      return outstanding == null || overdue == null || outstanding <= 0 ? null : Math.round((overdue / outstanding) * 1000) / 10;
    }
  },
  {
    key: "audience.subscribers",
    label: "Subscribers",
    domain: "audience",
    unit: "count",
    direction: "higher",
    description: "People currently subscribed to this territory's emails.",
    formula: "Count of territory subscriptions with status subscribed.",
    source: "audience_territory_subscriptions",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT territory_id, COUNT(*)::float8 AS value
      FROM audience_territory_subscriptions WHERE deleted_at IS NULL AND status = 'subscribed'
      GROUP BY territory_id`
  },
  {
    key: "audience.subscriber_growth_30d",
    label: "Net subscriber growth (30 days)",
    domain: "audience",
    unit: "count",
    direction: "higher",
    description: "New subscribers minus people who unsubscribed in the last 30 days.",
    formula: "Subscriptions started in the last 30 days minus subscriptions ended in the last 30 days.",
    source: "audience_territory_subscriptions",
    window: "rolling_30_days",
    kind: "query",
    query: ({ since }) => sql`
      SELECT territory_id,
        (COUNT(*) FILTER (WHERE subscribed_at >= ${since.toISOString()}::timestamptz)
         - COUNT(*) FILTER (WHERE unsubscribed_at >= ${since.toISOString()}::timestamptz))::float8 AS value
      FROM audience_territory_subscriptions WHERE deleted_at IS NULL
      GROUP BY territory_id`
  },
  {
    key: "audience.newsletters_sent_30d",
    label: "Newsletters sent (30 days)",
    domain: "audience",
    unit: "count",
    direction: "higher",
    description: "Email campaigns sent for this territory in the last 30 days.",
    formula: "Count of territory campaigns with status sent and sent on or after 30 days ago.",
    source: "email_campaigns",
    window: "rolling_30_days",
    kind: "query",
    query: ({ since }) => sql`
      SELECT territory_id, COUNT(*)::float8 AS value
      FROM email_campaigns
      WHERE deleted_at IS NULL AND territory_id IS NOT NULL AND status = 'sent' AND sent_at >= ${since.toISOString()}::timestamptz
      GROUP BY territory_id`
  },
  {
    key: "publishing.edition_approval_share",
    label: "Editions approved or published",
    domain: "publishing",
    unit: "percent",
    direction: "higher",
    description: "How far this territory's live editions have progressed past review. No data when there are no editions.",
    formula: "Editions in approved, generating or published divided by all non-archived editions, as a percentage.",
    source: "territory_editions",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT territory_id,
        ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('approved', 'generating', 'published')) / NULLIF(COUNT(*), 0), 1)::float8 AS value
      FROM territory_editions WHERE deleted_at IS NULL AND status <> 'archived'
      GROUP BY territory_id`
  },
  {
    key: "publishing.content_approved_30d",
    label: "Content approved (30 days)",
    domain: "publishing",
    unit: "count",
    direction: "higher",
    description: "Territory content items approved in the last 30 days.",
    formula: "Count of territory content items approved on or after 30 days ago.",
    source: "content_items",
    window: "rolling_30_days",
    kind: "query",
    query: ({ since }) => sql`
      SELECT territory_id, COUNT(*)::float8 AS value
      FROM content_items
      WHERE deleted_at IS NULL AND territory_id IS NOT NULL AND approved_at >= ${since.toISOString().slice(0, 10)}::date
      GROUP BY territory_id`
  },
  {
    key: "franchise.open_compliance_actions",
    label: "Open compliance actions",
    domain: "franchise",
    unit: "count",
    direction: "lower",
    description: "Compliance actions raised for the franchise that are still open.",
    formula: "Count of compliance actions with status open for the franchise in this territory.",
    source: "franchise_compliance_actions, franchises",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT f.primary_territory_id AS territory_id, COUNT(*)::float8 AS value
      FROM franchise_compliance_actions a JOIN franchises f ON f.id = a.franchise_id
      WHERE a.deleted_at IS NULL AND f.deleted_at IS NULL AND a.status = 'open'
      GROUP BY f.primary_territory_id`
  },
  {
    key: "franchise.overdue_compliance_actions",
    label: "Overdue compliance actions",
    domain: "franchise",
    unit: "count",
    direction: "lower",
    description: "Open compliance actions past their due date.",
    formula: "Count of open compliance actions whose due date is before today.",
    source: "franchise_compliance_actions, franchises",
    window: "current",
    kind: "query",
    query: ({ today }) => sql`
      SELECT f.primary_territory_id AS territory_id, COUNT(*)::float8 AS value
      FROM franchise_compliance_actions a JOIN franchises f ON f.id = a.franchise_id
      WHERE a.deleted_at IS NULL AND f.deleted_at IS NULL AND a.status = 'open' AND a.due_date < ${today}::date
      GROUP BY f.primary_territory_id`
  },
  {
    key: "franchise.onboarding_tasks_overdue",
    label: "Overdue onboarding tasks",
    domain: "franchise",
    unit: "count",
    direction: "lower",
    description: "Onboarding tasks past their due date and not yet completed.",
    formula: "Count of onboarding tasks not completed or approved whose due date is before today.",
    source: "franchise_onboarding_tasks, franchise_onboarding_programmes, franchises",
    window: "current",
    kind: "query",
    query: ({ today }) => sql`
      SELECT f.primary_territory_id AS territory_id, COUNT(*)::float8 AS value
      FROM franchise_onboarding_tasks t
      JOIN franchise_onboarding_programmes p ON p.id = t.programme_id
      JOIN franchises f ON f.id = p.franchise_id
      WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND f.deleted_at IS NULL
        AND t.status NOT IN ('completed', 'approved') AND t.due_date < ${today}::date
      GROUP BY f.primary_territory_id`
  },
  {
    key: "operations.tasks_overdue",
    label: "Overdue tasks",
    domain: "operations",
    unit: "count",
    direction: "lower",
    description: "Workflow tasks for this territory that are open and past their due date.",
    formula: "Count of open workflow tasks whose due date is before today.",
    source: "workflow_tasks",
    window: "current",
    kind: "query",
    query: ({ today }) => sql`
      SELECT territory_id, COUNT(*)::float8 AS value
      FROM workflow_tasks WHERE territory_id IS NOT NULL AND status = 'open' AND due_date < ${today}::date
      GROUP BY territory_id`
  },
  {
    key: "operations.jobs_dead_lettered",
    label: "Failed background jobs",
    domain: "operations",
    unit: "count",
    direction: "lower",
    description: "Background jobs for this territory that ran out of retries and need attention.",
    formula: "Count of jobs with status dead for the territory.",
    source: "jobs",
    window: "current",
    kind: "query",
    query: () => sql`
      SELECT territory_id, COUNT(*)::float8 AS value
      FROM jobs WHERE territory_id IS NOT NULL AND status = 'dead'
      GROUP BY territory_id`
  },
  {
    key: "operations.ai_spend_30d",
    label: "AI spend (30 days)",
    domain: "operations",
    unit: "minor_currency",
    direction: "neutral",
    description: "Estimated AI cost attributed to the territory in the last 30 days (informational, never scored).",
    formula: "Sum of estimated AI cost for the territory since 30 days ago.",
    source: "ai_usage_events",
    window: "rolling_30_days",
    kind: "query",
    query: ({ since }) => sql`
      SELECT territory_id, COALESCE(SUM(estimated_cost_minor), 0)::float8 AS value
      FROM ai_usage_events WHERE territory_id IS NOT NULL AND created_at >= ${since.toISOString()}::timestamptz
      GROUP BY territory_id`
  }
];

export const metricByKey = new Map(metricCatalogue.map((definition) => [definition.key, definition]));

export function requireMetric(key: string): MetricDefinition {
  const definition = metricByKey.get(key);
  if (!definition) throw new Error(`Unknown metric "${key}".`);
  return definition;
}

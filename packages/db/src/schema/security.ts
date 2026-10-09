import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./common";
import { audienceContacts } from "./marketing";
import { users } from "./identity";

/**
 * Fixed-window counters behind the shared rate limiter. The key is a hash of the limiter
 * name and the identifier (IP, email, user), never the raw value, so the table holds no PII.
 */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { mode: "date", withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0)
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] }), index("rate_limit_buckets_window_start_idx").on(table.windowStart)]
);

/**
 * A data-subject request (access/export or erasure) for an audience contact. After erasure the
 * request keeps only the contact id and a hash of the email, so the record of having honoured it
 * does not itself retain the personal data.
 */
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id,
    kind: text("kind").notNull(),
    status: text("status").notNull().default("requested"),
    subjectContactId: uuid("subject_contact_id").references(() => audienceContacts.id),
    subjectEmailHash: text("subject_email_hash").notNull(),
    requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
    requestNote: text("request_note"),
    /** UK GDPR: respond without undue delay and within one month. */
    dueAt: timestamp("due_at", { mode: "date", withTimezone: true }).notNull(),
    decidedByUserId: uuid("decided_by_user_id").references(() => users.id),
    decidedAt: timestamp("decided_at", { mode: "date", withTimezone: true }),
    decisionNote: text("decision_note"),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true }),
    /** Counts of what was exported or erased, per data category. Never the data itself. */
    resultSummary: jsonb("result_summary").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps
  },
  (table) => [
    index("privacy_requests_status_idx").on(table.status),
    index("privacy_requests_due_at_idx").on(table.dueAt),
    index("privacy_requests_subject_contact_idx").on(table.subjectContactId),
    index("privacy_requests_email_hash_idx").on(table.subjectEmailHash)
  ]
);

/**
 * Provider webhook events already handled. The unique (provider, event id) is the idempotency guard: a retry,
 * or the same event arriving on another serverless instance, finds its claim and is skipped. The claim is
 * written in the same transaction as the work, so a failure rolls both back and the provider's retry runs again.
 */
export const webhookEventClaims = pgTable(
  "webhook_event_claims",
  {
    id,
    providerKey: text("provider_key").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type"),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex("webhook_event_claims_provider_event_uidx").on(table.providerKey, table.eventId), index("webhook_event_claims_claimed_at_idx").on(table.claimedAt)]
);

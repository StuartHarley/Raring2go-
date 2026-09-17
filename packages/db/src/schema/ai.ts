import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

/**
 * One immutable row per successful AI call - append-only, like audit_events,
 * so it deliberately has no updatedAt/deletedAt.
 */
export const aiUsageEvents = pgTable(
  "ai_usage_events",
  {
    id,
    organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    feature: text("feature").notNull(),
    providerKey: text("provider_key").notNull(),
    modelReference: text("model_reference").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    estimatedCostMinor: integer("estimated_cost_minor").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("ai_usage_events_organisation_id_created_at_idx").on(table.organisationId, table.createdAt),
    index("ai_usage_events_territory_id_created_at_idx").on(table.territoryId, table.createdAt)
  ]
);

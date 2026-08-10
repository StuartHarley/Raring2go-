import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const auditEvents = pgTable(
  "audit_events",
  {
    id,
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow()
  },
  (table) => [
    index("audit_events_actor_user_id_idx").on(table.actorUserId),
    index("audit_events_entity_idx").on(table.entityType, table.entityId),
    index("audit_events_organisation_id_idx").on(table.organisationId),
    index("audit_events_territory_id_idx").on(table.territoryId),
    index("audit_events_created_at_idx").on(table.createdAt)
  ]
);

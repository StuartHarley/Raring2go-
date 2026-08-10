import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { organisations } from "./tenancy";

export const users = pgTable(
  "users",
  {
    id,
    email: text("email").notNull(),
    displayName: text("display_name"),
    status: text("status").notNull().default("active"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_status_idx").on(table.status),
    index("users_deleted_at_idx").on(table.deletedAt)
  ]
);

export const memberships = pgTable(
  "memberships",
  {
    id,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id),
    status: text("status").notNull().default("active"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("memberships_user_organisation_uidx").on(
      table.userId,
      table.organisationId
    ),
    index("memberships_organisation_id_idx").on(table.organisationId),
    index("memberships_user_id_idx").on(table.userId)
  ]
);

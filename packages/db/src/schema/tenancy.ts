import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";

export const organisations = pgTable(
  "organisations",
  {
    id,
    kind: text("kind", {
      enum: ["hq", "franchise", "advertiser"]
    }).notNull(),
    name: text("name").notNull(),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("organisations_kind_idx").on(table.kind),
    index("organisations_deleted_at_idx").on(table.deletedAt)
  ]
);

export const territories = pgTable(
  "territories",
  {
    id,
    franchiseOrganisationId: uuid("franchise_organisation_id").references(
      () => organisations.id
    ),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("territories_code_uidx").on(table.code),
    index("territories_franchise_organisation_id_idx").on(
      table.franchiseOrganisationId
    ),
    index("territories_deleted_at_idx").on(table.deletedAt)
  ]
);

import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { organisations, territories } from "./tenancy";
import { users } from "./identity";

export const fileReferences = pgTable(
  "file_references",
  {
    id,
    providerKey: text("provider_key").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size"),
    checksum: text("checksum"),
    accessScope: text("access_scope").notNull(),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    version: integer("version").notNull().default(1),
    virusScanStatus: text("virus_scan_status").notNull().default("pending"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    index("file_references_organisation_idx").on(table.organisationId),
    index("file_references_territory_idx").on(table.territoryId),
    index("file_references_owner_idx").on(table.ownerUserId),
    index("file_references_scan_status_idx").on(table.virusScanStatus),
    index("file_references_deleted_at_idx").on(table.deletedAt)
  ]
);

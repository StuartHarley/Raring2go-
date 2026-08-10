import { boolean, index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, softDelete, timestamps } from "./common";
import { users } from "./identity";
import { organisations, territories } from "./tenancy";

export const roles = pgTable(
  "roles",
  {
    id,
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
    ...softDelete
  },
  (table) => [
    uniqueIndex("roles_key_uidx").on(table.key),
    index("roles_deleted_at_idx").on(table.deletedAt)
  ]
);

export const permissions = pgTable(
  "permissions",
  {
    id,
    module: text("module").notNull(),
    action: text("action").notNull(),
    description: text("description"),
    ...timestamps
  },
  (table) => [
    uniqueIndex("permissions_module_action_uidx").on(table.module, table.action)
  ]
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    constraints: jsonb("constraints").notNull().default({})
  },
  (table) => [
    primaryKey({
      columns: [table.roleId, table.permissionId, table.scope]
    }),
    index("role_permissions_permission_id_idx").on(table.permissionId)
  ]
);

export const userRoleAssignments = pgTable(
  "user_role_assignments",
  {
    id,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }),
    endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
    ...timestamps
  },
  (table) => [
    index("user_role_assignments_user_id_idx").on(table.userId),
    index("user_role_assignments_role_id_idx").on(table.roleId),
    index("user_role_assignments_organisation_id_idx").on(table.organisationId),
    index("user_role_assignments_territory_id_idx").on(table.territoryId)
  ]
);

export const territoryAccess = pgTable(
  "territory_access",
  {
    id,
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    territoryId: uuid("territory_id")
      .notNull()
      .references(() => territories.id),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }),
    endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex("territory_access_user_territory_reason_uidx").on(
      table.userId,
      table.territoryId,
      table.reason
    ),
    index("territory_access_territory_id_idx").on(table.territoryId)
  ]
);

export const delegations = pgTable(
  "delegations",
  {
    id,
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id),
    organisationId: uuid("organisation_id").references(() => organisations.id),
    territoryId: uuid("territory_id").references(() => territories.id),
    reason: text("reason").notNull(),
    startsAt: timestamp("starts_at", { mode: "date", withTimezone: true })
      .notNull(),
    endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [
    index("delegations_from_user_id_idx").on(table.fromUserId),
    index("delegations_to_user_id_idx").on(table.toUserId),
    index("delegations_organisation_id_idx").on(table.organisationId),
    index("delegations_territory_id_idx").on(table.territoryId)
  ]
);

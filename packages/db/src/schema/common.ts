import { timestamp, uuid } from "drizzle-orm/pg-core";

export const id = uuid("id").defaultRandom().primaryKey();

export const timestamps = {
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow()
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true })
};

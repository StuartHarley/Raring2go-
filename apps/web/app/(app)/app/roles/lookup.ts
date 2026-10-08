import { createDb, users } from "@raring2go/db";
import { and, isNull, sql } from "drizzle-orm";

/** Find an existing account by email (case-insensitive), for assigning a role to a known person. */
export async function directoryLookupByEmail(email: string): Promise<{ id: string } | undefined> {
  if (!email) return undefined;
  const { db, sql: client } = createDb();
  try {
    const [row] = await db.select({ id: users.id }).from(users).where(and(sql`lower(${users.email}) = ${email.toLowerCase()}`, isNull(users.deletedAt))).limit(1);
    return row;
  } finally {
    await client.end();
  }
}

import { randomUUID } from "node:crypto";
import { createDb } from "@raring2go/db";
import { sql as rawSql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { POST } from "./route";

const post = (body: unknown, ip = `203.0.113.${Math.floor(Math.random() * 250)}`) =>
  POST(new Request("http://localhost/api/public/analytics", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) }));

describe("public analytics endpoint input handling", () => {
  it("rejects malformed events before touching the database", async () => {
    expect((await post({ eventType: "not_an_event", territorySlug: "sutton-coldfield", path: "/x" })).status).toBe(400);
    expect((await post({ territorySlug: "sutton-coldfield" })).status).toBe(400);
  });
});

/** Real database: an accepted event must actually be stored. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("public analytics endpoint (postgres)", () => {
  const { db, sql } = createDb();
  const path = `/areas/sutton-coldfield/test-${randomUUID().slice(0, 8)}`;

  afterAll(async () => {
    await db.execute(rawSql`delete from public_analytics_events where path = ${path}`);
    await sql.end();
  });

  it("stores a valid event without IP or user agent and refuses unknown areas and unsafe paths", async () => {
    const stored = await post({ eventType: "content_viewed", territorySlug: "sutton-coldfield", path, entityType: "content", entityId: randomUUID() });
    expect(stored.status).toBe(202);
    const rows = await db.execute(rawSql`select privacy, retain_until > now() as retained from public_analytics_events where path = ${path}`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ retained: true, privacy: { rawIpStored: false, userAgentStored: false } });

    expect((await post({ eventType: "content_viewed", territorySlug: "nowhere", path })).status).toBe(400);
    expect((await post({ eventType: "content_viewed", territorySlug: "sutton-coldfield", path: "//evil.example" })).status).toBe(400);
  });
});

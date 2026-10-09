import { randomUUID } from "node:crypto";
import { auditEvents, createDb, fixtureIds } from "@raring2go/db";
import { recordAuditEvent } from "@raring2go/audit";
import { like, sql as dsql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AUDIT_PAGE_SIZE, parseAuditFilters, readAuditEvents } from "./audit-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

describe("audit filters", () => {
  it("accepts well-formed values and ignores malformed ones instead of trusting them", () => {
    const parsed = parseAuditFilters({ action: " advertiser. ", actor: "not-a-uuid", territory: fixtureIds.territories.suttonColdfield, from: "2026-13-45x", to: "2026-10-09", before: "junk" });
    expect(parsed).toMatchObject({ actionPrefix: "advertiser.", actorUserId: undefined, territoryId: fixtureIds.territories.suttonColdfield, from: undefined, to: "2026-10-09" });
    expect(parseAuditFilters({ action: ["a", "b"] }).actionPrefix).toBe("a");
    expect(parseAuditFilters({ action: "x".repeat(500) }).actionPrefix).toHaveLength(80);
  });
});

/** Real database: the audit trail cannot be changed or removed, and can be searched and paged. `RUN_DB_TESTS=1 pnpm --filter @raring2go/web test` */
describe.skipIf(!process.env.RUN_DB_TESTS)("audit trail (postgres)", () => {
  const { db, sql } = createDb();
  const tag = `audtest${randomUUID().slice(0, 8)}`;
  const actor = fixtureIds.users.superAdmin;

  const record = (action: string, entityType = "audit_test") =>
    recordAuditEvent(db, { action, actor: { type: "human", userId: actor }, entity: { type: entityType, id: randomUUID() }, after: { tag } });

  afterAll(async () => {
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(like(auditEvents.action, `${tag}%`));
    });
    await sql.end();
  });

  it("refuses to update, delete or truncate a recorded event, at the database", async () => {
    const event = await record(`${tag}.immutable`);
    await expect(db.execute(dsql`update audit_events set action = 'tampered' where id = ${event.id}`)).rejects.toThrow();
    await expect(db.execute(dsql`update audit_events set payload = '{}'::jsonb where id = ${event.id}`)).rejects.toThrow();
    await expect(db.execute(dsql`delete from audit_events where id = ${event.id}`)).rejects.toThrow();
    await expect(db.execute(dsql`truncate audit_events`)).rejects.toThrow();
    const found = await readAuditEvents({ actionPrefix: `${tag}.immutable` });
    expect(found.events).toHaveLength(1);
    expect(found.events[0]!.action).toBe(`${tag}.immutable`);
  });

  it("searches by action prefix, treating % and _ as plain characters", async () => {
    await record(`${tag}.alpha.one`);
    await record(`${tag}.alpha.two`);
    await record(`${tag}.beta.one`);
    await db.insert(auditEvents).values({ actorUserId: actor, action: `${tag}%weird`, entityType: "audit_test", payload: {} });
    expect((await readAuditEvents({ actionPrefix: `${tag}.alpha.` })).events.map((event) => event.action).sort()).toEqual([`${tag}.alpha.one`, `${tag}.alpha.two`]);
    expect((await readAuditEvents({ actionPrefix: `${tag}%` })).events.map((event) => event.action)).toEqual([`${tag}%weird`]);
    expect((await readAuditEvents({ actionPrefix: `${tag}_`, entityType: "audit_test" })).events).toHaveLength(0);
    expect((await readAuditEvents({ actionPrefix: `${tag}.`, entityType: "no_such_type" })).events).toHaveLength(0);
  });

  it("pages through everything once, newest first, with no gaps or repeats", async () => {
    const total = AUDIT_PAGE_SIZE + 7;
    for (let index = 0; index < total; index += 1) await record(`${tag}.page.p${String(index).padStart(3, "0")}`);
    const first = await readAuditEvents({ actionPrefix: `${tag}.page.` });
    expect(first.events).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await readAuditEvents({ actionPrefix: `${tag}.page.`, before: first.nextCursor! });
    expect(second.events).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.events, ...second.events].map((event) => event.id);
    expect(new Set(ids).size).toBe(total);
    const times = [...first.events, ...second.events].map((event) => new Date(event.createdAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});

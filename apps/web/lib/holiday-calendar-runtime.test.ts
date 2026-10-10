import { randomUUID } from "node:crypto";
import { auditEvents, createDb, fixtureIds, schoolHolidayPeriods } from "@raring2go/db";
import { HolidayCalendarError } from "@raring2go/marketing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { HolidayNotAllowedError, addHolidayPeriod, readHolidayCalendar, removeHolidayPeriod } from "./holiday-calendar-runtime";
import { withFinanceGuardsDisabled } from "./finance-test-support";

/** Real database: HQ maintains the school-holiday calendar; nobody else can. `RUN_DB_TESTS=1` */
describe.skipIf(!process.env.RUN_DB_TESTS)("school holiday calendar (postgres)", () => {
  const { db, sql } = createDb();
  const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq, territoryId: null };
  const franchisee = { userId: fixtureIds.users.franchisee, organisationId: fixtureIds.organisations.franchise, territoryId: fixtureIds.territories.suttonColdfield };
  const tag = randomUUID().slice(0, 8);
  const ids: string[] = [];
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  afterAll(async () => {
    await withFinanceGuardsDisabled(db, async () => {
      await db.delete(auditEvents).where(inArray(auditEvents.entityId, ids));
    });
    if (ids.length) await db.delete(schoolHolidayPeriods).where(inArray(schoolHolidayPeriods.id, ids));
    await sql.end();
  });

  it("lets HQ add, list and remove holidays, with audit, and refuses everyone else", async () => {
    await expect(readHolidayCalendar(franchisee)).rejects.toBeInstanceOf(HolidayNotAllowedError);
    await expect(addHolidayPeriod(franchisee, { name: `Nope ${tag}`, startsOn: day(10), endsOn: day(12) })).rejects.toBeInstanceOf(HolidayNotAllowedError);

    const network = await addHolidayPeriod(hq, { name: `  Half   term ${tag} `, startsOn: day(10), endsOn: day(14) });
    const local = await addHolidayPeriod(hq, { name: `Local break ${tag}`, startsOn: day(20), endsOn: day(21), territoryId: fixtureIds.territories.solihull });
    ids.push(network.id, local.id);

    const listed = (await readHolidayCalendar(hq)).periods.filter((p) => ids.includes(p.id));
    expect(listed.map((p) => [p.name, p.startsOn, p.endsOn, p.areaName])).toEqual([[`Half term ${tag}`, day(10), day(14), "Every area"], [`Local break ${tag}`, day(20), day(21), expect.stringContaining("Solihull")]]);

    await expect(addHolidayPeriod(hq, { name: `Half term ${tag}`, startsOn: day(10), endsOn: day(14) })).rejects.toMatchObject({ code: "holiday_exists" });
    await expect(addHolidayPeriod(hq, { name: `Bad ${tag}`, startsOn: day(10), endsOn: day(5) })).rejects.toMatchObject({ code: "holiday_order" });
    await expect(addHolidayPeriod(hq, { name: `Where ${tag}`, startsOn: day(10), endsOn: day(11), territoryId: randomUUID() })).rejects.toMatchObject({ code: "holiday_area" });

    await removeHolidayPeriod(hq, network.id);
    expect((await readHolidayCalendar(hq)).periods.some((p) => p.id === network.id)).toBe(false);
    const [row] = await db.select().from(schoolHolidayPeriods).where(eq(schoolHolidayPeriods.id, network.id));
    expect(row!.deletedAt).toBeInstanceOf(Date);
    await expect(removeHolidayPeriod(hq, network.id)).rejects.toBeInstanceOf(HolidayCalendarError);
    await expect(removeHolidayPeriod(franchisee, local.id)).rejects.toBeInstanceOf(HolidayNotAllowedError);

    const audit = await db.select().from(auditEvents).where(inArray(auditEvents.entityId, ids));
    expect(audit.filter((event) => event.action === "marketing.holiday_calendar.change")).toHaveLength(3);
  });
});

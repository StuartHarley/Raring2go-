import { recordAuditEvent, auditActions } from "@raring2go/audit";
import { createDb, schoolHolidayPeriods, territories } from "@raring2go/db";
import { HolidayCalendarError, validateHolidayPeriod } from "@raring2go/marketing";
import type { HolidayPeriodInput } from "@raring2go/marketing";
import { evaluatePermission } from "@raring2go/permissions";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getPermissionData } from "./permission-source";

export type HolidayActor = { userId: string; organisationId?: string | null; territoryId?: string | null };

export class HolidayNotAllowedError extends Error {
  constructor() {
    super("No permission grant matched this request.");
    this.name = "HolidayNotAllowedError";
  }
}

async function requireManage(actor: HolidayActor) {
  const permissions = await getPermissionData();
  const decision = evaluatePermission({ userId: actor.userId, module: "marketing.calendar", action: "manage", context: { organisationId: actor.organisationId ?? undefined, territoryId: actor.territoryId ?? undefined } }, permissions);
  if (!decision.allowed) throw new HolidayNotAllowedError();
}

const day = (value: Date | string) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));

export async function readHolidayCalendar(actor: HolidayActor) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    const rows = await db.select().from(schoolHolidayPeriods).where(isNull(schoolHolidayPeriods.deletedAt)).orderBy(asc(schoolHolidayPeriods.startsOn));
    const areas = await db.select({ id: territories.id, name: territories.name }).from(territories).where(isNull(territories.deletedAt));
    return {
      periods: rows.map((row) => ({ id: row.id, name: row.name, startsOn: day(row.startsOn), endsOn: day(row.endsOn), territoryId: row.territoryId, areaName: row.territoryId ? areas.find((area) => area.id === row.territoryId)?.name ?? "Area" : "Every area" })),
      areas
    };
  } finally {
    await sql.end();
  }
}

export async function addHolidayPeriod(actor: HolidayActor, input: HolidayPeriodInput) {
  await requireManage(actor);
  const period = validateHolidayPeriod(input);
  const { db, sql } = createDb();
  try {
    return await db.transaction(async (tx) => {
      if (period.territoryId) {
        const [area] = await tx.select({ id: territories.id }).from(territories).where(and(eq(territories.id, period.territoryId), isNull(territories.deletedAt)));
        if (!area) throw new HolidayCalendarError("Unknown area.", "holiday_area");
      }
      const existing = await tx.select().from(schoolHolidayPeriods).where(and(eq(schoolHolidayPeriods.name, period.name), isNull(schoolHolidayPeriods.deletedAt)));
      if (existing.some((row) => day(row.startsOn) === period.startsOn && (row.territoryId ?? null) === period.territoryId)) throw new HolidayCalendarError("Duplicate.", "holiday_exists");
      const [created] = await tx.insert(schoolHolidayPeriods).values({ territoryId: period.territoryId, name: period.name, startsOn: new Date(`${period.startsOn}T00:00:00Z`), endsOn: new Date(`${period.endsOn}T00:00:00Z`), createdByUserId: actor.userId }).returning({ id: schoolHolidayPeriods.id });
      await recordAuditEvent(tx, { action: auditActions.marketingHolidayCalendarChange, actor: { type: "human", userId: actor.userId }, entity: { type: "school_holiday_period", id: created!.id }, scope: { organisationId: actor.organisationId ?? undefined, territoryId: period.territoryId ?? undefined }, after: { action: "add", ...period } });
      return { id: created!.id };
    });
  } finally {
    await sql.end();
  }
}

export async function removeHolidayPeriod(actor: HolidayActor, periodId: string) {
  await requireManage(actor);
  const { db, sql } = createDb();
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(schoolHolidayPeriods).where(and(eq(schoolHolidayPeriods.id, periodId), isNull(schoolHolidayPeriods.deletedAt)));
      if (!row) throw new HolidayCalendarError("Not found.", "holiday_missing");
      await tx.update(schoolHolidayPeriods).set({ deletedAt: new Date() }).where(eq(schoolHolidayPeriods.id, row.id));
      await recordAuditEvent(tx, { action: auditActions.marketingHolidayCalendarChange, actor: { type: "human", userId: actor.userId }, entity: { type: "school_holiday_period", id: row.id }, scope: { organisationId: actor.organisationId ?? undefined, territoryId: row.territoryId ?? undefined }, after: { action: "remove", name: row.name } });
    });
  } finally {
    await sql.end();
  }
}

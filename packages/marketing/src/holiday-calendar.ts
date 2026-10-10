/**
 * The school-holiday calendar and the rule for when a countdown is due. Pure, so the daily scan and the tests use the same code.
 */

export type HolidayPeriodInput = { name: string; startsOn: string; endsOn: string; territoryId?: string | null };
export type HolidayPeriod = { id: string; territoryId: string | null; name: string; startsOn: string; endsOn: string };

export type HolidayErrorCode = "holiday_name" | "holiday_dates" | "holiday_order" | "holiday_length" | "holiday_range" | "holiday_exists" | "holiday_area" | "holiday_missing";

export const holidayErrorText: Record<HolidayErrorCode | "not_allowed" | "not_found", string> = {
  holiday_name: "Give the holiday a name of up to 80 characters.",
  holiday_dates: "A date is not a valid calendar date (use YYYY-MM-DD).",
  holiday_order: "The holiday cannot end before it starts.",
  holiday_length: "A holiday of more than 60 days is probably a mistake.",
  holiday_range: "The start date must be within the next two years (and not before 2020).",
  holiday_exists: "That holiday is already in the calendar.",
  holiday_area: "That area does not exist.",
  holiday_missing: "That holiday was not found.",
  not_allowed: "You do not have permission to change the holiday calendar.",
  not_found: "That holiday was not found."
};

export class HolidayCalendarError extends Error {
  constructor(message: string, readonly code: HolidayErrorCode) {
    super(message);
    this.name = "HolidayCalendarError";
  }
}

const DAY_MS = 86_400_000;

function isoDay(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HolidayCalendarError("Bad date.", "holiday_dates");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new HolidayCalendarError("Bad date.", "holiday_dates");
  return time;
}

export function validateHolidayPeriod(input: HolidayPeriodInput, today: Date = new Date()): { name: string; startsOn: string; endsOn: string; territoryId: string | null } {
  const name = input.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new HolidayCalendarError("Bad name.", "holiday_name");
  const start = isoDay(input.startsOn);
  const end = isoDay(input.endsOn);
  if (end < start) throw new HolidayCalendarError("End before start.", "holiday_order");
  if ((end - start) / DAY_MS > 60) throw new HolidayCalendarError("Too long.", "holiday_length");
  const todayStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (start < Date.UTC(2020, 0, 1) || start > todayStart + 2 * 366 * DAY_MS) throw new HolidayCalendarError("Out of range.", "holiday_range");
  return { name, startsOn: input.startsOn, endsOn: input.endsOn, territoryId: input.territoryId || null };
}

/** Whole days from today (UTC) to a date; 0 is today, negative is past. */
export function daysUntil(date: string, now: Date): number {
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((isoDay(date) - todayStart) / DAY_MS);
}

/** Holidays that have not started and start within `daysBefore` days, for the territory (calendar entries with no territory apply to all). */
export function holidaysDueForCountdown(periods: HolidayPeriod[], territoryId: string, daysBefore: number, now: Date): Array<HolidayPeriod & { daysUntil: number }> {
  return periods
    .filter((period) => !period.territoryId || period.territoryId === territoryId)
    .map((period) => ({ ...period, daysUntil: daysUntil(period.startsOn, now) }))
    .filter((period) => period.daysUntil >= 1 && period.daysUntil <= daysBefore)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

/** "Saturday 25 October", in the UK, from a calendar date. */
export function formatHolidayDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

/** The ISO year and week, as "2026-W41", so a weekly digest has a stable key. */
export function isoWeekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

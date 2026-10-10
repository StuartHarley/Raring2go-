import { describe, expect, it } from "vitest";
import { HolidayCalendarError, daysUntil, formatHolidayDate, holidaysDueForCountdown, isoWeekKey, validateHolidayPeriod } from "./holiday-calendar";

const now = new Date("2026-10-10T08:00:00Z");
const code = (fn: () => unknown) => {
  try { fn(); return "ok"; } catch (error) { return error instanceof HolidayCalendarError ? error.code : "other"; }
};

describe("holiday calendar", () => {
  it("validates a period", () => {
    expect(validateHolidayPeriod({ name: "  Autumn   half term ", startsOn: "2026-10-26", endsOn: "2026-10-30" }, now)).toEqual({ name: "Autumn half term", startsOn: "2026-10-26", endsOn: "2026-10-30", territoryId: null });
    expect(code(() => validateHolidayPeriod({ name: " ", startsOn: "2026-10-26", endsOn: "2026-10-30" }, now))).toBe("holiday_name");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "2026-02-30", endsOn: "2026-03-01" }, now))).toBe("holiday_dates");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "26/10/2026", endsOn: "2026-10-30" }, now))).toBe("holiday_dates");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "2026-10-30", endsOn: "2026-10-26" }, now))).toBe("holiday_order");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "2026-10-26", endsOn: "2027-01-30" }, now))).toBe("holiday_length");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "2019-12-01", endsOn: "2019-12-05" }, now))).toBe("holiday_range");
    expect(code(() => validateHolidayPeriod({ name: "x", startsOn: "2031-12-01", endsOn: "2031-12-05" }, now))).toBe("holiday_range");
  });
  it("counts days and finds holidays due for a countdown, for the right area only", () => {
    expect(daysUntil("2026-10-26", now)).toBe(16);
    expect(daysUntil("2026-10-10", now)).toBe(0);
    const periods = [
      { id: "a", territoryId: null, name: "Autumn half term", startsOn: "2026-10-26", endsOn: "2026-10-30" },
      { id: "b", territoryId: "t1", name: "Local closure", startsOn: "2026-10-20", endsOn: "2026-10-21" },
      { id: "c", territoryId: "t2", name: "Other area", startsOn: "2026-10-18", endsOn: "2026-10-19" },
      { id: "d", territoryId: null, name: "Started", startsOn: "2026-10-10", endsOn: "2026-10-12" },
      { id: "e", territoryId: null, name: "Christmas", startsOn: "2026-12-19", endsOn: "2027-01-03" }
    ];
    expect(holidaysDueForCountdown(periods, "t1", 14, now).map((p) => p.id)).toEqual(["b"]);
    expect(holidaysDueForCountdown(periods, "t1", 16, now).map((p) => [p.id, p.daysUntil])).toEqual([["b", 10], ["a", 16]]);
    expect(holidaysDueForCountdown(periods, "t2", 14, now).map((p) => p.id)).toEqual(["c"]);
    expect(holidaysDueForCountdown(periods, "t1", 3, now)).toEqual([]);
  });
  it("formats dates and names the ISO week", () => {
    expect(formatHolidayDate("2026-10-26")).toBe("Monday 26 October");
    expect(isoWeekKey(new Date("2026-10-10T08:00:00Z"))).toBe("2026-W41");
    expect(isoWeekKey(new Date("2026-12-31T08:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-01T08:00:00Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2026-10-12T00:00:00Z"))).toBe("2026-W42");
  });
});

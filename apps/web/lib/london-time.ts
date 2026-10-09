/**
 * "09:00 on 12 October" typed into a form means London wall-clock time, which is UTC+0 in winter and UTC+1
 * in summer. Converting with a fixed offset would post an hour early or late for half the year, so the
 * offset is looked up for the exact moment.
 */
const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});

function londonWallClockAsUtc(instant: number) {
  const parts = Object.fromEntries(londonParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

/** `2026-10-12T09:00` (from a datetime-local input) as an ISO instant, or undefined if it is not a real London time. */
export function londonLocalToIso(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, y, mo, d, h, mi] = match.map(Number) as unknown as number[];
  const wanted = Date.UTC(y!, mo! - 1, d!, h!, mi!);
  const check = new Date(wanted);
  // Date.UTC rolls 30 February over to March; a real calendar time reads back as what was typed.
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo! - 1 || check.getUTCDate() !== d || check.getUTCHours() !== h || check.getUTCMinutes() !== mi) return undefined;

  // Two passes settle the offset, including right after a clock change.
  let instant = wanted;
  for (let pass = 0; pass < 2; pass += 1) instant = wanted - (londonWallClockAsUtc(instant) - instant);

  // A time that does not exist (the hour skipped in spring) or is ambiguous resolves to a different wall clock.
  return londonWallClockAsUtc(instant) === wanted ? new Date(instant).toISOString() : undefined;
}

export function formatLondon(iso: string | null | undefined) {
  if (!iso) return "not scheduled";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

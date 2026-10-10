/**
 * Presentation helpers for anything a person reads on screen. Domain services return machine
 * values (snake_case statuses, ISO dates, UUIDs); pages turn them into words here so no raw
 * identifier or enum string reaches a user.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID.test(value);
}

/** "pending_review" → "Pending review", "needs-watch" → "Needs watch", "ACTIVE" → "Active". */
export function formatLabel(value: string | null | undefined, fallback = "Unknown"): string {
  if (!value) return fallback;
  const words = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
  if (!words) return fallback;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A list of machine values as a readable sentence fragment: ["missing_image", "no_standfirst"] → "Missing image, No standfirst". */
export function formatLabels(values: ReadonlyArray<string>, separator = ", "): string {
  return values.map((value) => formatLabel(value)).join(separator);
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London"
});

function toDate(value: string | Date | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** "2026-08-10" → "10 Aug 2026". Unparseable or missing dates show the fallback rather than "Invalid Date". */
export function formatDate(value: string | Date | null | undefined, fallback = "Not set"): string {
  const date = toDate(value);
  return date ? dateFormatter.format(date) : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = "Not set"): string {
  const date = toDate(value);
  return date ? dateTimeFormatter.format(date) : fallback;
}

/** "1 edition" / "3 editions". Pass an irregular plural when "s" is wrong. */
export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The name to show for a record when the lookup may have failed. A UUID is never an acceptable
 * title, so a missing name falls back to a human phrase instead of the identifier.
 */
export function displayName(name: string | null | undefined, fallback: string): string {
  if (name && !isUuid(name)) return name;
  return fallback;
}

/** The first name from a display name, for greetings. Falls back to the whole name or "there". */
export function firstName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

/** Initials for an avatar: "Jane Example-Smith" → "JE". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Dotted event and job codes as words: "advertiser.invoice.created" → "Advertiser invoice created". */
export function formatCode(value: string | null | undefined, fallback = "Unknown"): string {
  return formatLabel(value?.replace(/\./g, " "), fallback);
}

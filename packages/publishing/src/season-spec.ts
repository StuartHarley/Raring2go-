import type { MasterEdition, Season } from "./types";

/** Validates the new-season form into a Season and MasterEdition. A trust boundary: every field is checked, nothing is reflected back. */

export type SeasonFormInput = {
  key: string;
  name: string;
  year: string;
  season: string;
  accent: string;
  pageCount: string;
  publicationDate?: string;
  bookingDeadline?: string;
  artworkDeadline?: string;
  editorialDeadline?: string;
  proofDeadline?: string;
  printDeadline?: string;
  distributionDate?: string;
};

export type SeasonErrorCode = "season_key" | "season_name" | "season_year" | "season_season" | "season_accent" | "season_pages" | "season_date" | "season_date_order";

export const seasonErrorText: Record<SeasonErrorCode | "season_exists", string> = {
  season_key: "The key must be lower-case letters, digits and hyphens, starting with a letter.",
  season_name: "Give the season a name.",
  season_year: "The year must be between 2020 and 2100.",
  season_season: "Choose spring, summer, autumn or winter.",
  season_accent: "The accent colour must be a hex colour such as #c04000.",
  season_pages: "The page count must be a multiple of 4 from 8 to 200.",
  season_date: "A date is not a valid calendar date (use YYYY-MM-DD).",
  season_date_order: "The deadlines must run in order: booking, artwork, editorial, proof, print, distribution, publication.",
  season_exists: "A season with that key already exists."
};

export class SeasonSpecError extends Error {
  constructor(message: string, readonly code: SeasonErrorCode) {
    super(message);
    this.name = "SeasonSpecError";
  }
}

const DATE_KEYS = ["bookingDeadline", "artworkDeadline", "editorialDeadline", "proofDeadline", "printDeadline", "distributionDate", "publicationDate"] as const;

function isoDate(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new SeasonSpecError("Bad date.", "season_date");
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) throw new SeasonSpecError("Bad date.", "season_date");
  return text;
}

export function buildSeasonAndMaster(input: SeasonFormInput, ids: { seasonId: string; masterId: string; organisationId: string; userId: string }): { season: Season; masterEdition: MasterEdition } {
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9-]{1,59}$/.test(key)) throw new SeasonSpecError("Bad key.", "season_key");
  const name = input.name.trim();
  if (!name || name.length > 120) throw new SeasonSpecError("Bad name.", "season_name");
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new SeasonSpecError("Bad year.", "season_year");
  if (!["spring", "summer", "autumn", "winter"].includes(input.season)) throw new SeasonSpecError("Bad season.", "season_season");
  if (!/^#[0-9a-fA-F]{6}$/.test(input.accent.trim())) throw new SeasonSpecError("Bad accent.", "season_accent");
  const pageCount = Number(input.pageCount);
  if (!Number.isInteger(pageCount) || pageCount < 8 || pageCount > 200 || pageCount % 4 !== 0) throw new SeasonSpecError("Bad page count.", "season_pages");

  const dates = Object.fromEntries(DATE_KEYS.map((field) => [field, isoDate(input[field])])) as Record<(typeof DATE_KEYS)[number], string | null>;
  const given = DATE_KEYS.map((field) => dates[field]).filter((value): value is string => value !== null);
  if (given.some((value, index) => index > 0 && value < given[index - 1]!)) throw new SeasonSpecError("Dates out of order.", "season_date_order");

  const season: Season = {
    id: ids.seasonId,
    key,
    name,
    year,
    season: input.season,
    status: "planned",
    accent: input.accent.trim(),
    ...dates
  };
  const masterEdition: MasterEdition = {
    id: ids.masterId,
    seasonId: ids.seasonId,
    organisationId: ids.organisationId,
    title: `${name} Master Edition`,
    status: "draft",
    pageCount,
    version: 1,
    readiness: "not_ready",
    publicationArchive: {},
    locked: false,
    createdByUserId: ids.userId
  };
  return { season, masterEdition };
}

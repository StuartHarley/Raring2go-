import { describe, expect, it } from "vitest";
import { buildSeasonAndMaster, SeasonSpecError } from "./season-spec";

const ids = { seasonId: "s", masterId: "m", organisationId: "o", userId: "u" };
const ok = { key: "autumn-2027", name: "Autumn 2027", year: "2027", season: "autumn", accent: "#c04000", pageCount: "36", bookingDeadline: "2027-07-01", artworkDeadline: "2027-07-15", publicationDate: "2027-09-01" };

describe("season form", () => {
  it("builds a season and a draft master", () => {
    const { season, masterEdition } = buildSeasonAndMaster(ok, ids);
    expect(season).toMatchObject({ key: "autumn-2027", status: "planned", proofDeadline: null, publicationDate: "2027-09-01" });
    expect(masterEdition).toMatchObject({ seasonId: "s", organisationId: "o", pageCount: 36, status: "draft", title: "Autumn 2027 Master Edition" });
  });
  it.each([
    [{ key: "Bad Key" }, "season_key"],
    [{ name: " " }, "season_name"],
    [{ year: "1999" }, "season_year"],
    [{ season: "monsoon" }, "season_season"],
    [{ accent: "red" }, "season_accent"],
    [{ pageCount: "30" }, "season_pages"],
    [{ pageCount: "4" }, "season_pages"],
    [{ bookingDeadline: "2027-02-30" }, "season_date"],
    [{ bookingDeadline: "2027-08-01" }, "season_date_order"]
  ])("refuses %j", (patch, code) => {
    expect(() => buildSeasonAndMaster({ ...ok, ...patch }, ids)).toThrow(SeasonSpecError);
    try { buildSeasonAndMaster({ ...ok, ...patch }, ids); } catch (error) { expect((error as SeasonSpecError).code).toBe(code); }
  });
});

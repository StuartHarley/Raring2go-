import { describe, expect, it } from "vitest";
import { bulkActionStatus, filterControlRoom, MAX_BULK_EDITIONS, parseBulkSelection } from "./control-room";
import type { EditionControlRoomRow } from "./types";

const row = (over: Record<string, unknown>) => ({ territoryEdition: { id: "e", title: "Autumn Sutton", status: "draft" }, territory: { name: "Sutton" }, season: { id: "s1" }, riskStatus: "on_track", blockedPages: 0, hqActions: 0, localActions: 0, ...over }) as unknown as EditionControlRoomRow;

describe("control room filters", () => {
  const rows = [row({}), row({ season: { id: "s2" }, riskStatus: "blocked", blockedPages: 2, territoryEdition: { id: "f", title: "Spring Solihull", status: "review" }, territory: { name: "Solihull" } })];
  it("filters by season, risk, status, search and attention", () => {
    expect(filterControlRoom(rows, {})).toHaveLength(2);
    expect(filterControlRoom(rows, { seasonId: "s2" })).toHaveLength(1);
    expect(filterControlRoom(rows, { risk: "blocked" })[0]!.territoryEdition.id).toBe("f");
    expect(filterControlRoom(rows, { status: "review" })).toHaveLength(1);
    expect(filterControlRoom(rows, { search: " SOLI " })).toHaveLength(1);
    expect(filterControlRoom(rows, { needsAttention: true })).toHaveLength(1);
    expect(filterControlRoom(rows, { seasonId: "s1", risk: "blocked" })).toHaveLength(0);
  });
  it("parses selections safely", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(parseBulkSelection([id, id, "not-an-id", `${id}x`]).ids).toEqual([id]);
    const many = Array.from({ length: MAX_BULK_EDITIONS + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(parseBulkSelection(many)).toMatchObject({ truncated: true });
    expect(parseBulkSelection(many).ids).toHaveLength(MAX_BULK_EDITIONS);
    expect(bulkActionStatus.approve).toEqual(["review"]);
  });
});

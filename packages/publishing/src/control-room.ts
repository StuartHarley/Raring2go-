import type { EditionControlRoomRow } from "./types";

/** Filtering and bulk-selection rules for the Control Room, kept pure so they are tested without a page. */

export type ControlRoomFilters = {
  seasonId?: string;
  risk?: "on_track" | "watch" | "blocked";
  status?: string;
  search?: string;
  needsAttention?: boolean;
};

export function filterControlRoom(rows: EditionControlRoomRow[], filters: ControlRoomFilters): EditionControlRoomRow[] {
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (filters.seasonId && row.season.id !== filters.seasonId) return false;
    if (filters.risk && row.riskStatus !== filters.risk) return false;
    if (filters.status && row.territoryEdition.status !== filters.status) return false;
    if (filters.needsAttention && row.blockedPages === 0 && row.hqActions === 0 && row.localActions === 0) return false;
    if (search && !`${row.territoryEdition.title} ${row.territory?.name ?? ""}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

export const bulkActions = ["submit", "approve", "release", "digital", "print"] as const;
export type BulkAction = (typeof bulkActions)[number];

export const bulkActionLabels: Record<BulkAction, string> = {
  submit: "Submit for review",
  approve: "Approve",
  release: "Publish",
  digital: "Queue digital output",
  print: "Queue print output"
};

/** What an edition must be in for each bulk action to be worth attempting; the domain still decides. */
export const bulkActionStatus: Record<BulkAction, string[]> = {
  submit: ["draft", "localising"],
  approve: ["review"],
  release: ["approved"],
  digital: ["approved", "published"],
  print: ["approved", "published"]
};

export const MAX_BULK_EDITIONS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Selected ids from a form: only well-formed ids, no duplicates, capped so one click cannot fan out without limit. */
export function parseBulkSelection(values: string[]): { ids: string[]; truncated: boolean } {
  const unique = [...new Set(values.map((value) => value.trim()).filter((value) => UUID.test(value)))];
  return { ids: unique.slice(0, MAX_BULK_EDITIONS), truncated: unique.length > MAX_BULK_EDITIONS };
}

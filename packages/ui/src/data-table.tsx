"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Column<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** When set, the column can be sorted by this value. */
  sortValue?: (row: Row) => string | number;
  /** The row's identifying cell is marked as a row header for screen readers. */
  rowHeader?: boolean;
};

type Sort = { key: string; direction: "ascending" | "descending" } | null;

/**
 * A semantic table: a caption, real header cells, sortable columns that are buttons (keyboard and screen-reader
 * friendly, `aria-sort` kept current), and an explicit empty state rather than a blank grid.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  emptyMessage = "Nothing to show yet."
}: {
  caption: string;
  columns: Array<Column<Row>>;
  rows: Row[];
  rowKey: (row: Row) => string;
  emptyMessage?: string;
}) {
  const [sort, setSort] = useState<Sort>(null);

  const sorted = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort?.key);
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.direction === "ascending" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = value(left);
      const b = value(right);
      return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * factor;
    });
  }, [rows, columns, sort]);

  function toggle(key: string) {
    setSort((current) => (current?.key === key && current.direction === "ascending" ? { key, direction: "descending" } : { key, direction: "ascending" }));
  }

  return (
    <div className="r2-table-wrap" role="region" aria-label={caption} tabIndex={0}>
      <table className="r2-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" aria-sort={column.sortValue ? (sort?.key === column.key ? sort.direction : "none") : undefined}>
                {column.sortValue ? (
                  <button type="button" onClick={() => toggle(column.key)}>{column.header}</button>
                ) : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length}>{emptyMessage}</td></tr>
          ) : sorted.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => column.rowHeader
                ? <th key={column.key} scope="row">{column.render(row)}</th>
                : <td key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

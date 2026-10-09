import type { TemplateZone } from "@raring2go/publishing";

const fills: Record<string, string> = { headline: "#f6d7a8", copy: "#cfe3f5", image: "#d5ead0", list: "#e9d5f0", advertiser: "#f5c9c9", editable: "#e5e5e5" };

/** Draws a template's trim box, live area and placed zones. Un-placed zones are listed, not drawn, because their position is decided at render time. */
export function ZonePreview({ width, height, margins, zones, label }: { width: number; height: number; margins: { top: number; right: number; bottom: number; left: number }; zones: TemplateZone[]; label: string }) {
  const placed = zones.filter((zone) => zone.x !== undefined && zone.y !== undefined && zone.width !== undefined && zone.height !== undefined);
  const unplaced = zones.filter((zone) => !placed.includes(zone));
  return (
    <figure className="zone-preview">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ width: "100%", maxWidth: 220, border: "1px solid #999", background: "#fff" }}>
        <rect x={margins.left} y={margins.top} width={width - margins.left - margins.right} height={height - margins.top - margins.bottom} fill="none" stroke="#bbb" strokeDasharray="2 2" strokeWidth={0.4} />
        {placed.map((zone) => (
          <g key={zone.id}>
            <rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} fill={fills[zone.kind] ?? "#eee"} stroke="#555" strokeWidth={0.4} />
            <text x={zone.x! + 1.5} y={zone.y! + 5} fontSize={Math.max(3, Math.min(6, width / 40))} fill="#222">{zone.id}</text>
          </g>
        ))}
      </svg>
      <figcaption>
        {width} x {height} mm. Dashed line: live area.
        {unplaced.length > 0 ? ` Stacked at render time: ${unplaced.map((zone) => zone.id).join(", ")}.` : ""}
      </figcaption>
    </figure>
  );
}

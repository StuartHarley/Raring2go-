import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Route } from "next";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList, StatusBadge, toneForStatus } from "./page-ui";

describe("page anatomy on the design system", () => {
  it("renders a page header with one h1 and right-aligned actions", () => {
    const html = renderToString(
      <PageHeader eyebrow="Commercial" title="Advertisers" intro="Who is advertising with you." actions={<LinkButton href={"/app/advertisers/pipeline" as Route}>Open pipeline</LinkButton>} />
    );
    expect(html).toContain("<h1>Advertisers</h1>");
    expect(html).toContain('class="eyebrow"');
    expect(html).toContain('class="r2-button r2-button--primary"');
    expect(html).toContain('href="/app/advertisers/pipeline"');
  });

  it("builds panels and KPI tiles from the ui package primitives", () => {
    const html = renderToString(
      <Panel eyebrow="Today" title="Numbers" accent="brand">
        <Metrics items={[{ label: "Editions at risk", value: 2, detail: "1 blocked", tone: "danger" }, { label: "Advertisers", value: "10" }]} />
      </Panel>
    );
    expect(html).toContain("r2-card r2-card--brand app-panel");
    expect(html).toContain("r2-badge r2-badge--danger");
    expect(html).toContain("r2-badge r2-badge--neutral");
    expect(html).toContain("<strong>2</strong>");
    expect(html).toContain("1 blocked");
  });

  it("shows statuses as words with a colour that follows their meaning", () => {
    expect(renderToString(<StatusBadge status="pending_review" />)).toContain("Pending review");
    expect(renderToString(<StatusBadge status="pending_review" />)).toContain("r2-badge--warning");
    expect(renderToString(<StatusBadge status="failed" />)).toContain("r2-badge--danger");
    expect(renderToString(<StatusBadge status="retained" />)).toContain("r2-badge--success");
    expect(renderToString(<StatusBadge status={undefined} />)).toContain("Unknown");
    expect(toneForStatus("something_new")).toBe("neutral");
  });

  it("links records with a title, status pill and plain-English lines, dropping empty lines", () => {
    const html = renderToString(
      <RecordList>
        <RecordLink href={"/app/franchisees/f1" as Route} title="Sutton Coldfield" status="active" lines={["Lifecycle: Trading", null, "3 open actions"]} />
      </RecordList>
    );
    expect(html).toContain('href="/app/franchisees/f1"');
    expect(html).toContain("Sutton Coldfield");
    expect(html).toContain("Active");
    expect((html.match(/record-link__line/g) ?? []).length).toBe(2);
  });

  it("gives empty states a status role so screen readers announce them", () => {
    const html = renderToString(<EmptyState title="No open tasks">You are up to date.</EmptyState>);
    expect(html).toContain('role="status"');
    expect(html).toContain("No open tasks");
    expect(html).toContain("You are up to date.");
  });
});

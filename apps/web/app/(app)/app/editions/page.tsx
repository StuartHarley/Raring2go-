import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { bulkActionLabels, bulkActionStatus, bulkActions, filterControlRoom } from "@raring2go/publishing";
import type { BulkAction } from "@raring2go/publishing";
import { formatDate, formatLabel, formatLabels } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, Notice, PageHeader, Panel, StatusBadge, Table } from "../../../../lib/page-ui";
import { listEditionFactoryRows } from "../../../../lib/publishing-runtime";
import { bulkEditionAction } from "./actions";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Edition Factory" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const editionStatuses = ["draft", "localising", "review", "approved", "published"];

export default async function EditionsPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await loadEditions(request);
  const param = (name: string) => (Array.isArray(search[name]) ? search[name]![0] : search[name]) as string | undefined;

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const allRows = result.rows;
  const risk = ["on_track", "watch", "blocked"].includes(param("risk") ?? "") ? (param("risk") as "on_track" | "watch" | "blocked") : undefined;
  const rows = filterControlRoom(allRows, { seasonId: param("season"), risk, status: param("status"), search: param("q"), needsAttention: param("attention") === "1" });
  const seasons = [...new Map(allRows.map((row) => [row.season.id, row.season.name])).entries()];
  const doneAction = bulkActions.includes(param("action") as BulkAction) ? bulkActionLabels[param("action") as BulkAction] : "";
  const blockedCount = allRows.filter((row) => row.riskStatus === "blocked").length;
  const watchCount = allRows.filter((row) => row.riskStatus === "watch").length;
  const generatedCount = allRows.filter(
    (row) => row.printStatus === "generated" || row.digitalStatus === "generated"
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Edition Factory"
        intro="Every seasonal edition in production across the network, with what is blocked and what is due next."
        actions={
          result.canTemplates ? (
            <>
              <LinkButton href={"/app/editions/seasons" as Route} variant="primary">
                Seasons and masters
              </LinkButton>
              <LinkButton href={"/app/editions/templates" as Route} variant="secondary">
                Template library
              </LinkButton>
            </>
          ) : undefined
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Territory editions", value: allRows.length },
            { label: "Blocked", value: blockedCount, tone: blockedCount > 0 ? "danger" : "success" },
            { label: "Needs watch", value: watchCount, tone: watchCount > 0 ? "warning" : "success" },
            { label: "Outputs generated", value: generatedCount, tone: generatedCount > 0 ? "success" : undefined }
          ]}
        />
      </Panel>

      <Panel id="queue" eyebrow="Live editions" title={`Production queue (${rows.length} of ${allRows.length})`}>
        {param("result") === "bulk_done" ? (
          <Notice tone="success">
            {doneAction}: {param("done") ?? "0"} done, {param("refused") ?? "0"} not ready or not permitted (they were left unchanged).
            {param("capped") ? " Only the first 100 selected were processed." : ""}
          </Notice>
        ) : null}
        {param("result") === "bulk_none_selected" ? <Notice tone="error">Tick at least one edition.</Notice> : null}
        {param("result") === "bulk_no_action" ? <Notice tone="error">Choose an action.</Notice> : null}

        <form method="get" className="franchise-form" aria-label="Filter editions">
          <label>
            Search
            <input name="q" defaultValue={param("q") ?? ""} />
          </label>
          <label>
            Season
            <select name="season" defaultValue={param("season") ?? ""}>
              <option value="">All</option>
              {seasons.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Risk
            <select name="risk" defaultValue={param("risk") ?? ""}>
              <option value="">All</option>
              <option value="blocked">Blocked</option>
              <option value="watch">Watch</option>
              <option value="on_track">On track</option>
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={param("status") ?? ""}>
              <option value="">All</option>
              {editionStatuses.map((status) => (
                <option key={status} value={status}>
                  {formatLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input type="checkbox" name="attention" value="1" defaultChecked={param("attention") === "1"} /> Needs attention only
          </label>
          {request.sessionKey ? <input type="hidden" name="session" value={request.sessionKey} /> : null}
          {request.organisationId ? <input type="hidden" name="organisationId" value={request.organisationId} /> : null}
          {request.territoryId ? <input type="hidden" name="territoryId" value={request.territoryId} /> : null}
          <button type="submit" className="r2-button r2-button--secondary">
            Filter
          </button>
        </form>

        {rows.length === 0 ? (
          allRows.length === 0 ? (
            <EmptyState title="No editions in production">Territory editions appear here once a season is planned and generated for your territories.</EmptyState>
          ) : (
            <EmptyState title="No editions match these filters">Clear a filter or two to see the rest of the queue.</EmptyState>
          )
        ) : (
          <form action={bulkEditionAction.bind(null, request)}>
            <fieldset className="franchise-form">
              <legend>Bulk action on ticked editions (up to 100)</legend>
              <label>
                Action
                <select name="action" defaultValue="">
                  <option value="">Choose...</option>
                  {bulkActions.map((action) => (
                    <option key={action} value={action}>
                      {bulkActionLabels[action]}
                    </option>
                  ))}
                </select>
              </label>
              <Actions>
                <button type="submit" className="r2-button r2-button--primary">
                  Run on ticked
                </button>
              </Actions>
              <p className="muted">
                Each edition is checked on its own: one that is not ready is skipped and the rest go ahead. Outputs are queued and appear on each edition when rendered.
              </p>
            </fieldset>
            <Table caption="Editions in production, with their readiness and output status">
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">Edition</th>
                  <th scope="col">Status</th>
                  <th scope="col">Readiness</th>
                  <th scope="col">Print</th>
                  <th scope="col">Digital</th>
                  <th scope="col">Attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.territoryEdition.id}>
                    <td>
                      <input type="checkbox" name="editionIds" value={row.territoryEdition.id} aria-label={`Select ${row.territoryEdition.title}`} />
                    </td>
                    <th scope="row">
                      <Link href={`/app/editions/${row.territoryEdition.id}` as Route}>{row.territory?.name ?? row.territoryEdition.title}</Link>
                      <br />
                      <span className="muted">
                        {row.season.name} · {formatLabel(row.phase)}
                      </span>
                    </th>
                    <td>
                      <StatusBadge status={row.territoryEdition.status} />
                    </td>
                    <td>
                      {row.pagesReady}/{row.pagesTotal} pages ({row.completionPercent}%) <StatusBadge status={row.riskStatus} tone={row.riskStatus === "on_track" ? "success" : undefined} />
                    </td>
                    <td>
                      <StatusBadge status={row.printStatus} />
                    </td>
                    <td>
                      <StatusBadge status={row.digitalStatus} />
                    </td>
                    <td>
                      Local {row.localActions}, HQ {row.hqActions}, preflight failures {row.preflightFailures}. Next deadline {formatDate(row.nextDeadline, "not set")}.
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="muted">
              Applies to:{" "}
              {Object.entries(bulkActionStatus)
                .map(([action, statuses]) => `${bulkActionLabels[action as BulkAction]} (${formatLabels(statuses, " or ")})`)
                .join("; ")}
              .
            </p>
          </form>
        )}
      </Panel>
    </>
  );
}

async function loadEditions(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "edition",
      action: "view"
    });
    const rows = await listEditionFactoryRows({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    const canTemplates = await requireShellPermission(request, { module: "edition.template", action: "edit" }).then(() => true, (error) => {
      if (error instanceof ShellAccessError) return false;
      throw error;
    });

    return { rows, canTemplates };
  } catch (error) {
    return { error };
  }
}

import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { bulkActionLabels, bulkActionStatus, bulkActions, filterControlRoom } from "@raring2go/publishing";
import type { BulkAction } from "@raring2go/publishing";
import { listEditionFactoryRows } from "../../../../lib/publishing-runtime";
import { bulkEditionAction } from "./actions";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Edition Factory" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditionsPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await loadEditions(request);
  const param = (name: string) => (Array.isArray(search[name]) ? search[name]![0] : search[name]) as string | undefined;

  if ("error" in result) {
    return protectedOutcome(result.error, request);
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
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Edition Factory</p>
        <h2>HQ Control Room</h2>
        <p>
          Network-wide production status for seasonal territory editions, built
          from the same canonical edition records that feed print and digital output.
        </p>
        {result.canTemplates ? <p><Link href={"/app/editions/templates" as Route}>Template library</Link> - <Link href={"/app/editions/seasons" as Route}>Seasons and masters</Link></p> : null}
        <div className="franchise-metrics">
          <article>
            <span>Territory editions</span>
            <strong>{allRows.length}</strong>
          </article>
          <article>
            <span>Blocked</span>
            <strong>{blockedCount}</strong>
          </article>
          <article>
            <span>Needs watch</span>
            <strong>{watchCount}</strong>
          </article>
          <article>
            <span>Outputs generated</span>
            <strong>{generatedCount}</strong>
          </article>
        </div>
      </section>

      <section id="queue" className="app-panel franchise-panel">
        <p className="eyebrow">Live editions</p>
        <h2>Production queue ({rows.length} of {allRows.length})</h2>
        {param("result") === "bulk_done" ? (
          <p role="status">{doneAction}: {param("done") ?? "0"} done, {param("refused") ?? "0"} not ready or not permitted (they were left unchanged).{param("capped") ? " Only the first 100 selected were processed." : ""}</p>
        ) : null}
        {param("result") === "bulk_none_selected" ? <p role="alert">Tick at least one edition.</p> : null}
        {param("result") === "bulk_no_action" ? <p role="alert">Choose an action.</p> : null}
        <form method="get" className="franchise-form" aria-label="Filter editions">
          <label>Search<input name="q" defaultValue={param("q") ?? ""} /></label>
          <label>Season
            <select name="season" defaultValue={param("season") ?? ""}>
              <option value="">All</option>
              {seasons.map(([id, name]) => (<option key={id} value={id}>{name}</option>))}
            </select>
          </label>
          <label>Risk
            <select name="risk" defaultValue={param("risk") ?? ""}>
              <option value="">All</option><option value="blocked">Blocked</option><option value="watch">Watch</option><option value="on_track">On track</option>
            </select>
          </label>
          <label>Status
            <select name="status" defaultValue={param("status") ?? ""}>
              <option value="">All</option>{["draft", "localising", "review", "approved", "published"].map((status) => (<option key={status} value={status}>{status}</option>))}
            </select>
          </label>
          <label><input type="checkbox" name="attention" value="1" defaultChecked={param("attention") === "1"} /> Needs attention only</label>
          {request.sessionKey ? <input type="hidden" name="session" value={request.sessionKey} /> : null}
          {request.organisationId ? <input type="hidden" name="organisationId" value={request.organisationId} /> : null}
          {request.territoryId ? <input type="hidden" name="territoryId" value={request.territoryId} /> : null}
          <button type="submit">Filter</button>
        </form>
        {rows.length === 0 ? <p>No editions match these filters.</p> : (
          <form action={bulkEditionAction.bind(null, request)}>
            <fieldset>
              <legend>Bulk action on ticked editions (up to 100)</legend>
              <label>Action
                <select name="action" defaultValue="">
                  <option value="">Choose...</option>
                  {bulkActions.map((action) => (<option key={action} value={action}>{bulkActionLabels[action]}</option>))}
                </select>
              </label>
              <button type="submit">Run on ticked</button>
              <p className="muted">Each edition is checked on its own: one that is not ready is skipped and the rest go ahead. Outputs are queued and appear on each edition when rendered.</p>
            </fieldset>
            <table>
              <thead><tr><th>Select</th><th>Edition</th><th>Status</th><th>Readiness</th><th>Print</th><th>Digital</th><th>Attention</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.territoryEdition.id}>
                    <td><input type="checkbox" name="editionIds" value={row.territoryEdition.id} aria-label={`Select ${row.territoryEdition.title}`} /></td>
                    <td><Link href={`/app/editions/${row.territoryEdition.id}` as Route}>{row.territory?.name ?? row.territoryEdition.title}</Link><br /><span className="muted">{row.season.name}</span></td>
                    <td>{row.territoryEdition.status}</td>
                    <td>{row.pagesReady}/{row.pagesTotal} pages ({row.completionPercent}%) - {row.riskStatus.replace("_", " ")}</td>
                    <td>{row.printStatus}</td>
                    <td>{row.digitalStatus}</td>
                    <td>Local {row.localActions}, HQ {row.hqActions}, preflight failures {row.preflightFailures}. Next deadline {row.nextDeadline ?? "not set"}.</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">Applies to: {Object.entries(bulkActionStatus).map(([action, statuses]) => `${bulkActionLabels[action as BulkAction]} (${statuses.join(" or ")})`).join("; ")}.</p>
          </form>
        )}
      </section>
    </AppShell>
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

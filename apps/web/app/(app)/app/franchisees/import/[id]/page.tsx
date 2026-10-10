import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { readFranchiseImport } from "../../../../../../lib/franchise-import-runtime";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { commitFranchiseImportAction, rollbackFranchiseImportAction } from "../actions";
import type { FranchiseImportResult } from "../actions";

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const messages: Record<FranchiseImportResult, string> = {
  committed: "Imported.",
  rolled_back: "Import reversed.",
  already_done: "That had already been done. Nothing changed.",
  not_found: "That import was not found."
};

const outcomeLabels: Record<string, string> = {
  create: "New franchise and territory",
  reject_missing_field: "Rejected: a required column is empty",
  reject_invalid_code: "Rejected: territory code is not valid",
  reject_invalid_email: "Rejected: contact email is not valid",
  reject_invalid_date: "Rejected: a date is not valid",
  reject_dates_out_of_order: "Rejected: renewal is not after launch",
  reject_invalid_stage: "Rejected: stage is not trading or onboarding",
  reject_duplicate_in_file: "Rejected: repeated in this file",
  reject_code_exists: "Rejected: territory code already exists",
  reject_franchise_exists: "Rejected: franchise already exists"
};

export default async function FranchiseImportDetailPage({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const { id } = await params;
  const result = await load(request, id);
  if ("error" in result) return protectedOutcome(result.error);

  const { record, summary, sample, hasReport, rollback } = result.detail;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const banner = resultCode && Object.hasOwn(messages, resultCode) ? messages[resultCode as FranchiseImportResult] : undefined;

  return (
    <AppShell request={request}>
      {banner ? <p className={resultCode === "committed" || resultCode === "rolled_back" ? "notice notice--success" : "notice notice--error"} role="status">{banner}</p> : null}
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Import</p>
        <h2>{record.source}</h2>
        <p>{record.status === "dry_run" ? "This is a dry run: nothing has been added yet." : `Status: ${record.status.replaceAll("_", " ")}.`} File: {record.fileName}.</p>
        {summary ? (
          <div className="franchise-metrics">
            <article><span>Rows</span><strong>{summary.total}</strong></article>
            <article><span>{record.status === "dry_run" ? "Would be added" : "Added"}</span><strong>{summary.create}</strong></article>
            <article><span>Not added</span><strong>{summary.rejected}</strong></article>
          </div>
        ) : null}
        {hasReport ? <a className="app-link-button" href={`/app/franchisees/import/${record.id}/report${queryString}`}>Download the report of rows that were not added</a> : null}
      </section>

      {record.status === "dry_run" ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Preview</p>
          <h2>What would happen</h2>
          <div className="franchise-list">
            {sample.map((row) => (
              <div key={row.line}>
                <strong>Line {row.line}: {row.franchiseName || "(no name)"} ({row.territoryCode || "no code"})</strong>
                <span>{outcomeLabels[row.outcome] ?? row.outcome}</span>
                <span>{row.reason}</span>
              </div>
            ))}
          </div>
          <p>Showing the first {sample.length} rows. The report has every one.</p>
          <form action={commitFranchiseImportAction.bind(null, request, record.id)}>
            <p>Importing re-checks every row against the territories and franchises as they are at this moment, so a code or name added since the upload is left out, never duplicated.</p>
            <button type="submit">Import now</button>
          </form>
        </section>
      ) : null}

      {record.status === "applied" ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Reverse</p>
          <h2>Roll back this import</h2>
          <p>Removes the franchises this import created, but only those nothing else refers to yet: no agreement, user, edition, advertiser, invoice or other record. Any that has been worked on since is kept. A removed territory gives up its code so a corrected file can bring it back.</p>
          <form action={rollbackFranchiseImportAction.bind(null, request, record.id)}><button type="submit">Roll back this import</button></form>
        </section>
      ) : null}

      {rollback ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Rolled back</p>
          <p>{rollback.removed} franchise(s) removed, {rollback.leftAlone} kept because they have been worked on since.</p>
        </section>
      ) : null}

      <Link href={`/app/franchisees/import${queryString}` as Route} className="app-link-button">All imports</Link>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, importId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "franchise.import", action: "manage" });
    return { detail: await readFranchiseImport({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, importId) };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }
  return (
    <main className="app-outcome">
      <section>
        <h1>Import not found</h1>
        <p>It may not exist, or you may not have access to it.</p>
      </section>
    </main>
  );
}

import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { readAudienceImport } from "../../../../../../lib/audience-import-runtime";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { commitImportAction, rollbackImportAction } from "../actions";
import type { ImportResult } from "../actions";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const messages: Record<ImportResult, string> = {
  committed: "Imported.",
  rolled_back: "Import reversed. Nobody from it will be emailed.",
  already_done: "That had already been done. Nothing changed.",
  not_found: "That import was not found.",
  not_possible: "That is not possible for an import in its current state."
};

const outcomeLabels: Record<string, string> = {
  create_subscribed: "New, will be a subscriber (consent recorded)",
  create_pending: "New, on file but not emailed",
  add_subscription: "Existing person, joins this territory (consent recorded)",
  add_pending: "Existing person, joins this territory but not emailed",
  skip_already_subscribed: "Already subscribed here",
  skip_existing_no_evidence: "Already on file, waiting to confirm",
  reject_invalid_email: "Rejected: not a valid email",
  reject_duplicate_in_file: "Rejected: repeated in this file",
  reject_suppressed: "Rejected: suppressed",
  reject_previously_unsubscribed: "Rejected: unsubscribed from this territory"
};

export default async function AudienceImportDetailPage({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const { id } = await params;
  const result = await load(request, id);
  if ("error" in result) return protectedOutcome(result.error);

  const { record, summary, sample, hasReport } = result.detail;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const banner = resultCode && Object.hasOwn(messages, resultCode) ? messages[resultCode as ImportResult] : undefined;

  return (
    <AppShell request={request}>
      {banner ? <p className={resultCode === "committed" || resultCode === "rolled_back" ? "notice notice--success" : "notice notice--error"} role="status">{banner}</p> : null}
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Import</p>
        <h2>{record.source}</h2>
        <p>
          {record.status === "dry_run" ? "This is a dry run: nothing has been added yet." : `Status: ${record.status.replaceAll("_", " ")}.`}{" "}
          File: {record.metadata.fileName}.{" "}
          {record.metadata.basis === "consent_evidenced" ? "Declared as: people agreed, with consent recorded in the file." : "Declared as: no consent record. Nobody will be emailed."}
        </p>
        {summary ? (
          <div className="franchise-metrics">
            <article><span>Rows</span><strong>{summary.total}</strong></article>
            <article><span>New subscribers</span><strong>{summary.newSubscribed}</strong></article>
            <article><span>New, not emailed</span><strong>{summary.newPending}</strong></article>
            <article><span>Existing, joined</span><strong>{summary.addedToTerritory}</strong></article>
            <article><span>Already here</span><strong>{summary.alreadySubscribed}</strong></article>
            <article><span>Rejected</span><strong>{summary.rejected}</strong></article>
          </div>
        ) : null}
        {hasReport ? (
          <a className="app-link-button" href={`/app/audience/import/${record.id}/report${queryString}`}>Download the report of rejected and not-emailed rows</a>
        ) : null}
      </section>

      {record.status === "dry_run" ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Preview</p>
          <h2>What would happen</h2>
          <div className="franchise-list">
            {sample.map((row) => (
              <div key={row.line}>
                <strong>Line {row.line}: {row.email}</strong>
                <span>{outcomeLabels[row.outcome] ?? row.outcome}</span>
                <span>{row.reason}</span>
              </div>
            ))}
          </div>
          <p>Showing the first {sample.length} rows. The report has every one.</p>
          <form action={commitImportAction.bind(null, request, record.id)}>
            <p>Importing re-checks everyone against the audience at this moment, so anyone who unsubscribed since the upload is still left out.</p>
            <button type="submit">Import now</button>
          </form>
        </section>
      ) : null}

      {record.status === "committed" ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Reverse</p>
          <h2>Roll back this import</h2>
          <p>
            Withdraws the subscriptions this import created and records the withdrawal in each person&apos;s consent history. People who
            have since confirmed or changed their subscription themselves are left alone, and anyone already emailed cannot be un-emailed.
            The contact records stay (with nothing eligible to send); removing the people themselves is an erasure request.
          </p>
          <form action={rollbackImportAction.bind(null, request, record.id)}>
            <button type="submit">Roll back this import</button>
          </form>
        </section>
      ) : null}

      {record.metadata.rollback ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Rolled back</p>
          <p>
            {record.metadata.rollback.subscriptionsWithdrawn} subscription(s) withdrawn, {record.metadata.rollback.leftAlone} left alone because
            the person had changed them, {record.metadata.rollback.alreadyEmailed} person/people had already been emailed.
          </p>
        </section>
      ) : null}

      <Link href={`/app/audience/import${queryString}` as Route} className="app-link-button">All imports</Link>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, importId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "marketing.import", action: "manage" });
    const detail = await readAudienceImport({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, importId);
    return { detail };
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
        <p>It may belong to another territory, or no longer exist.</p>
      </section>
    </main>
  );
}

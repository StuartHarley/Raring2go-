import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readAudienceImport } from "../../../../../../lib/audience-import-runtime";
import { formatDate, formatLabel } from "../../../../../../lib/format";
import { Actions, FactList, LinkButton, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { commitImportAction, rollbackImportAction } from "../actions";
import type { ImportResult } from "../actions";
import { recordOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Audience import" };

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
  if ("error" in result) return recordOutcome(result.error, request);

  const { record, summary, sample, hasReport } = result.detail;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const banner = resultCode && Object.hasOwn(messages, resultCode) ? messages[resultCode as ImportResult] : undefined;
  const bannerTone = resultCode === "committed" || resultCode === "rolled_back" ? "success" : "error";
  const rollback = record.metadata.rollback;

  return (
    <AppShell request={request}>
      {banner ? <Notice tone={bannerTone}>{banner}</Notice> : null}
      <Breadcrumbs
        items={[
          { label: "Audience", href: `/app/audience${queryString}` as Route },
          { label: "Import", href: `/app/audience/import${queryString}` as Route },
          { label: record.source }
        ]}
      />
      <PageHeader
        eyebrow="Import"
        title={record.source}
        intro={
          <>
            {record.status === "dry_run" ? "This is a dry run: nothing has been added yet." : `Status: ${formatLabel(record.status)}.`} File: {record.metadata.fileName}.{" "}
            {record.metadata.basis === "consent_evidenced"
              ? "Declared as: people agreed, with consent recorded in the file."
              : "Declared as: no consent record. Nobody will be emailed."}
          </>
        }
        actions={
          <>
            {hasReport ? (
              <a className="r2-button r2-button--secondary" href={`/app/audience/import/${record.id}/report${queryString}`}>
                Download the report
              </a>
            ) : null}
            <LinkButton href={`/app/audience/import${queryString}` as Route} variant="secondary">
              All imports
            </LinkButton>
          </>
        }
      />

      {summary ? (
        <Panel eyebrow="Outcome" title="What this import does" intro={hasReport ? "The report lists every rejected and not-emailed row with the reason." : undefined}>
          <Metrics
            items={[
              { label: "Rows", value: summary.total },
              { label: "New subscribers", value: summary.newSubscribed, tone: summary.newSubscribed > 0 ? "success" : "neutral" },
              { label: "New, not emailed", value: summary.newPending },
              { label: "Existing, joined", value: summary.addedToTerritory },
              { label: "Already here", value: summary.alreadySubscribed },
              { label: "Rejected", value: summary.rejected, tone: summary.rejected > 0 ? "warning" : "success" }
            ]}
          />
        </Panel>
      ) : null}

      {record.status === "dry_run" ? (
        <Panel eyebrow="Preview" title="What would happen" intro={`Showing the first ${sample.length} rows. The report has every one.`}>
          <RecordList>
            {sample.map((row) => (
              <RecordCard key={row.line} title={`Line ${row.line}: ${row.email}`} lines={[outcomeLabels[row.outcome] ?? formatLabel(row.outcome), row.reason]} />
            ))}
          </RecordList>
          <form action={commitImportAction.bind(null, request, record.id)}>
            <p>Importing re-checks everyone against the audience at this moment, so anyone who unsubscribed since the upload is still left out.</p>
            <Actions>
              <button type="submit" className="r2-button r2-button--primary">
                Import now
              </button>
            </Actions>
          </form>
        </Panel>
      ) : null}

      {record.status === "committed" ? (
        <Panel
          eyebrow="Reverse"
          title="Roll back this import"
          intro="Withdraws the subscriptions this import created and records the withdrawal in each person's consent history. People who have since confirmed or changed their subscription themselves are left alone, and anyone already emailed cannot be un-emailed. The contact records stay (with nothing eligible to send); removing the people themselves is an erasure request."
        >
          <form action={rollbackImportAction.bind(null, request, record.id)}>
            <Actions>
              <button type="submit" className="r2-button r2-button--danger">
                Roll back this import
              </button>
            </Actions>
          </form>
        </Panel>
      ) : null}

      {rollback ? (
        <Panel eyebrow="Rolled back" title="This import was reversed" intro={`Rolled back ${formatDate(rollback.at)}.`}>
          <FactList
            items={[
              { label: "Subscriptions withdrawn", value: rollback.subscriptionsWithdrawn },
              { label: "Left alone (person had changed them)", value: rollback.leftAlone },
              { label: "Already emailed", value: rollback.alreadyEmailed }
            ]}
          />
        </Panel>
      ) : null}
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

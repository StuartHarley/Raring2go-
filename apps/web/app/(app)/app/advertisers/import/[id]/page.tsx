import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readAdvertiserImport } from "../../../../../../lib/advertiser-import-runtime";
import { formatLabel } from "../../../../../../lib/format";
import { Actions, FactList, LinkButton, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { commitAdvertiserImportAction, rollbackAdvertiserImportAction } from "../actions";
import type { AdvertiserImportResult } from "../actions";
import { recordOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "Advertiser import" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const messages: Record<AdvertiserImportResult, string> = {
  committed: "Imported.",
  rolled_back: "Import reversed.",
  already_done: "That had already been done. Nothing changed.",
  not_found: "That import was not found."
};

const outcomeLabels: Record<string, string> = {
  create: "New prospect",
  reject_missing_name: "Rejected: no business name",
  reject_invalid_email: "Rejected: contact email is not valid",
  reject_duplicate_in_file: "Rejected: repeated in this file",
  reject_exists: "Rejected: already an advertiser"
};

export default async function AdvertiserImportDetailPage({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const { id } = await params;
  const result = await load(request, id);
  if ("error" in result) return recordOutcome(result.error);

  const { record, summary, sample, hasReport, rollback } = result.detail;
  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const banner = resultCode && Object.hasOwn(messages, resultCode) ? messages[resultCode as AdvertiserImportResult] : undefined;
  const bannerTone = resultCode === "committed" || resultCode === "rolled_back" ? "success" : "error";

  return (
    <>
      {banner ? <Notice tone={bannerTone}>{banner}</Notice> : null}
      <Breadcrumbs
        items={[
          { label: "Advertisers", href: `/app/advertisers${queryString}` as Route },
          { label: "Import", href: `/app/advertisers/import${queryString}` as Route },
          { label: record.source }
        ]}
      />
      <PageHeader
        eyebrow="Import"
        title={record.source}
        intro={
          <>
            {record.status === "dry_run" ? "This is a dry run: nothing has been added yet." : `Status: ${formatLabel(record.status)}.`} File: {record.fileName}.
          </>
        }
        actions={
          <>
            {hasReport ? (
              <a className="r2-button r2-button--secondary" href={`/app/advertisers/import/${record.id}/report${queryString}`}>
                Download the report of rows not added
              </a>
            ) : null}
            <LinkButton href={`/app/advertisers/import${queryString}` as Route} variant="secondary">
              All imports
            </LinkButton>
          </>
        }
      />

      {summary ? (
        <Panel eyebrow="Outcome" title="What this import does" intro={hasReport ? "The report lists every row that was not added, with the reason." : undefined}>
          <Metrics
            items={[
              { label: "Rows", value: summary.total },
              { label: record.status === "dry_run" ? "Would be added" : "Added", value: summary.create, tone: summary.create > 0 ? "success" : "neutral" },
              { label: "Not added", value: summary.rejected, tone: summary.rejected > 0 ? "warning" : "success" }
            ]}
          />
        </Panel>
      ) : null}

      {record.status === "dry_run" ? (
        <Panel eyebrow="Preview" title="What would happen" intro={`Showing the first ${sample.length} rows. The report has every one.`}>
          <RecordList>
            {sample.map((row) => (
              <RecordCard key={row.line} title={`Line ${row.line}: ${row.businessName || "(no name)"}`} lines={[outcomeLabels[row.outcome] ?? formatLabel(row.outcome), row.reason]} />
            ))}
          </RecordList>
          <form action={commitAdvertiserImportAction.bind(null, request, record.id)}>
            <p>Importing re-checks every row against the advertisers as they are at this moment, so a business added since the upload is left out, never duplicated.</p>
            <Actions>
              <button type="submit" className="r2-button r2-button--primary">
                Import now
              </button>
            </Actions>
          </form>
        </Panel>
      ) : null}

      {record.status === "applied" ? (
        <Panel
          eyebrow="Reverse"
          title="Roll back this import"
          intro="Removes the businesses this import created, but only those still exactly as the import left them. Any that has since had a contact, task, opportunity, proposal, booking, invoice or artwork added, or a status change, is kept."
        >
          <form action={rollbackAdvertiserImportAction.bind(null, request, record.id)}>
            <Actions>
              <button type="submit" className="r2-button r2-button--danger">
                Roll back this import
              </button>
            </Actions>
          </form>
        </Panel>
      ) : null}

      {rollback ? (
        <Panel eyebrow="Rolled back" title="This import was reversed">
          <FactList
            items={[
              { label: "Businesses removed", value: rollback.removed },
              { label: "Kept (worked on since)", value: rollback.leftAlone }
            ]}
          />
        </Panel>
      ) : null}
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, importId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "advertiser.import", action: "manage" });
    return { detail: await readAdvertiserImport({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, importId) };
  } catch (error) {
    return { error };
  }
}

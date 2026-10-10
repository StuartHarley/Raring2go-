import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { listAdvertiserImports } from "../../../../../lib/advertiser-import-runtime";
import { getDirectory } from "../../../../../lib/directory";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, LinkButton, PageHeader, Panel, RecordLink, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { ImportUploadForm } from "./ImportUploadForm";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Import advertisers" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdvertiserImportPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request);
  if ("error" in result) return protectedOutcome(result.error);

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";

  return (
    <>
      <PageHeader
        eyebrow="Advertisers"
        title="Import advertisers"
        intro={
          <>
            Bring in a list of local businesses. The file is checked first and nothing changes until you approve it. Every business is added as a <strong>prospect</strong> in
            the chosen territory, with its contact if the file has one. An import never sends, prices, invoices or books anything, never signs anyone up to emails, and
            never changes a business that already exists. You can reverse an import afterwards.
          </>
        }
        actions={
          <LinkButton href={`/app/advertisers${queryString}` as Route} variant="secondary">
            Back to advertisers
          </LinkButton>
        }
      />

      <Panel eyebrow="New import" title="Check a file" intro="Checking changes nothing: you review what the import would do before anything is added.">
        <ImportUploadForm territories={result.territories} defaultTerritoryId={request.territoryId} queryString={queryString} />
      </Panel>

      <Panel eyebrow="History" title="Previous imports">
        {result.imports.length === 0 ? (
          <EmptyState title="No imports yet">Check a file above to see what an import would do before anything changes.</EmptyState>
        ) : (
          <RecordList>
            {result.imports.map((record) => (
              <RecordLink
                key={record.id}
                href={`/app/advertisers/import/${record.id}${queryString}` as Route}
                title={record.source}
                status={record.status}
                lines={[
                  `${formatCount(record.totalRows, "row")} · ${record.createdCount} added · ${record.rejectedCount} not added`,
                  `Uploaded ${formatDate(record.createdAt)}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "advertiser.import", action: "manage" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const all = await getDirectory().listTerritories();
    return { imports: await listAdvertiserImports(actor), territories: actor.territoryId ? all.filter((territory) => territory.id === actor.territoryId) : all };
  } catch (error) {
    return { error };
  }
}

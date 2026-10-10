import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { listAudienceImports } from "../../../../../lib/audience-import-runtime";
import { getDirectory } from "../../../../../lib/directory";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, LinkButton, PageHeader, Panel, RecordLink, RecordList } from "../../../../../lib/page-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { ImportUploadForm } from "./ImportUploadForm";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Import contacts" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AudienceImportPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request);
  if ("error" in result) return protectedOutcome(result.error, request);

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Audience"
        title="Import contacts"
        intro="Bring in an existing list safely: the file is checked first, nothing changes until you approve it, and you can reverse an import afterwards."
        actions={
          <LinkButton href={`/app/audience${queryString}` as Route} variant="secondary">
            Back to audience
          </LinkButton>
        }
      />

      <Panel
        eyebrow="New import"
        title="Check a file"
        intro="Only people with recorded consent are made subscribers; everyone else is added as &quot;not emailed&quot; until they confirm themselves."
      >
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
                href={`/app/audience/import/${record.id}${queryString}` as Route}
                title={record.source}
                status={record.status}
                lines={[
                  `${formatCount(record.totalRows, "row")} · ${record.importedRows} added · ${record.errorRows} rejected`,
                  `Uploaded ${formatDate(record.createdAt)}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "marketing.import", action: "manage" });
    const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const directory = getDirectory();
    const all = await directory.listTerritories();
    const territories = context.territoryId ? all.filter((territory) => territory.id === context.territoryId) : all;
    return { imports: await listAudienceImports(context), territories };
  } catch (error) {
    return { error };
  }
}

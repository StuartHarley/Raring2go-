import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { listFranchiseImports } from "../../../../../lib/franchise-import-runtime";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, LinkButton, PageHeader, Panel, RecordLink, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { ImportUploadForm } from "./ImportUploadForm";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Import franchises" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function FranchiseImportPage({ searchParams }: PageProps) {
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
        eyebrow="Franchise"
        title="Import franchises and territories"
        intro={
          <>
            Bring in a list of franchises with their territories. The file is checked first and nothing changes until you approve it. Each row creates a franchise, its territory
            and a primary contact if the file has one. An import never creates a user, a role, an agreement or an invoice, never signs anyone up to emails, and never changes a
            franchise or territory that already exists. You can reverse an import afterwards while nothing else refers to what it created.
          </>
        }
        actions={
          <LinkButton href={`/app/franchisees${queryString}` as Route} variant="secondary">
            Back to franchisees
          </LinkButton>
        }
      />

      <Panel eyebrow="New import" title="Check a file" intro="Checking changes nothing: you review what the import would do before anything is added.">
        <ImportUploadForm queryString={queryString} />
      </Panel>

      <Panel eyebrow="History" title="Previous imports">
        {result.imports.length === 0 ? (
          <EmptyState title="No imports yet">Check a file above to see what an import would do before anything changes.</EmptyState>
        ) : (
          <RecordList>
            {result.imports.map((record) => (
              <RecordLink
                key={record.id}
                href={`/app/franchisees/import/${record.id}${queryString}` as Route}
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
    const shell = await requireShellPermission(request, { module: "franchise.import", action: "manage" });
    const actor = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    return { imports: await listFranchiseImports(actor) };
  } catch (error) {
    return { error };
  }
}

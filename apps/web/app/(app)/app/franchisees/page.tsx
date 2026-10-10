import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { getDirectory } from "../../../../lib/directory";
import { displayName, formatCount, formatDate, formatLabel } from "../../../../lib/format";
import { listComplianceOverview, listFranchiseSummaries } from "../../../../lib/franchise-runtime";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "Franchisees" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FranchiseesPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFranchisees(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const trading = result.franchises.filter((franchise) => franchise.status === "active").length;
  const openActions = result.complianceOverview.reduce((total, row) => total + row.openActions, 0);
  const behind = result.complianceOverview.filter((row) => row.openActions > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Franchise"
        title="Franchisees"
        intro="Every franchise in the network: who runs each territory, whether they are trading, and where their compliance stands."
        actions={result.canImport ? <LinkButton href={"/app/franchisees/import" as Route} variant="secondary">Import franchises</LinkButton> : undefined}
      />

      <Panel>
        <Metrics
          items={[
            { label: "Franchises", value: result.franchises.length, detail: `${trading} trading` },
            { label: "Open compliance actions", value: openActions, tone: openActions > 0 ? "warning" : "success" },
            { label: "Behind on compliance", value: behind, detail: formatCount(result.complianceOverview.length, "franchise record"), tone: behind > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Network" title="Franchises">
        {result.franchises.length === 0 ? (
          <EmptyState title="No franchises in this context">Switch to the network view to see every franchise.</EmptyState>
        ) : (
          <RecordList>
            {result.franchises.map((franchise) => (
              <RecordLink
                key={franchise.id}
                href={`/app/franchisees/${franchise.id}` as Route}
                title={displayName(result.territoryNames.get(franchise.primaryTerritoryId), "Territory not named yet")}
                status={franchise.status}
                lines={[`Lifecycle: ${formatLabel(franchise.lifecycleStage)}`]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Compliance" title="Who needs chasing">
        {result.complianceOverview.length === 0 ? (
          <EmptyState title="No compliance records to show" />
        ) : (
          <RecordList>
            {result.complianceOverview.map((row) => (
              <RecordLink
                key={row.franchise.id}
                href={`/app/franchisees/${row.franchise.id}` as Route}
                title={displayName(row.territory?.name ?? result.territoryNames.get(row.franchise.primaryTerritoryId), "Territory not named yet")}
                status={row.status}
                lines={[
                  `${row.completeCount} of ${row.totalCount} requirements complete`,
                  `${formatCount(row.openActions, "open action")} · next due ${formatDate(row.nextDueDate)}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadFranchisees(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "franchise",
      action: "view"
    });
    const context = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const franchises = await listFranchiseSummaries(context);
    const complianceOverview = await listComplianceOverview(context).catch(() => []);

    const directory = getDirectory();
    const territoryIds = new Set<string>([
      ...franchises.map((franchise) => franchise.primaryTerritoryId),
      ...complianceOverview.map((row) => row.franchise.primaryTerritoryId)
    ]);
    const territoryNames = new Map<string, string | undefined>(
      await Promise.all([...territoryIds].map(async (id) => [id, await directory.territoryName(id).catch(() => undefined)] as const))
    );

    const canImport = await requireShellPermission(request, { module: "franchise.import", action: "manage" }).then(() => true, (error) => {
      if (error instanceof ShellAccessError) return false;
      throw error;
    });

    return { franchises, complianceOverview, territoryNames, canImport };
  } catch (error) {
    return { error };
  }
}

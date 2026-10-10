import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { formatDate, formatLabel } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { listEditionFactoryRows } from "../../../../lib/publishing-runtime";
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
        intro="Every seasonal edition in production, with what is blocked and what is due next."
        actions={
          result.canTemplates ? (
            <LinkButton href={"/app/editions/templates" as Route} variant="secondary">
              Template library
            </LinkButton>
          ) : undefined
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Territory editions", value: result.rows.length },
            { label: "Blocked", value: blockedCount, tone: blockedCount > 0 ? "danger" : "success" },
            { label: "Needs watch", value: watchCount, tone: watchCount > 0 ? "warning" : "success" },
            { label: "Outputs generated", value: generatedCount, tone: generatedCount > 0 ? "success" : undefined }
          ]}
        />
      </Panel>

      <Panel eyebrow="Live editions" title="Production queue">
        {result.rows.length === 0 ? (
          <EmptyState title="No editions in production">Territory editions appear here once a season is planned for your territories.</EmptyState>
        ) : (
          <RecordList>
            {result.rows.map((row) => (
              <RecordLink
                key={row.territoryEdition.id}
                href={`/app/editions/${row.territoryEdition.id}` as Route}
                title={row.territory?.name ?? row.territoryEdition.title}
                status={row.riskStatus}
                tone={row.riskStatus === "on_track" ? "success" : undefined}
                lines={[
                  `${row.season.name} · ${formatLabel(row.phase)}`,
                  `${row.pagesReady}/${row.pagesTotal} pages ready · ${row.completionPercent}% complete`,
                  `Local actions ${row.localActions} · HQ actions ${row.hqActions} · Next deadline ${formatDate(row.nextDeadline)}`
                ]}
              />
            ))}
          </RecordList>
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

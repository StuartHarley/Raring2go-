import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasMarketingCapability, listNetworkTerritories, readJourneyOverview } from "../../../../lib/marketing-runtime";
import { formatCount } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../page";
import { JourneyBuilderFields } from "./JourneyBuilderFields";
import { activateJourneyAction, createJourneyAction, pauseJourneyAction } from "./actions";
import type { MarketingActorContext } from "@raring2go/marketing";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Journeys" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JourneysPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJourneys(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, overview, territoryOptions, canCreate, canActivate, canPause } = result;
  const entries = overview.journeys.reduce((total, journey) => total + journey.entries, 0);
  const activeRuns = overview.journeys.reduce((total, journey) => total + journey.activeExecutions, 0);

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Journeys"
        intro="Automated email sequences for families who have opted in. Each version is approved before it runs, and you can see where runs are getting stuck."
        actions={canCreate ? <LinkButton href={"#new" as Route}>Create a journey</LinkButton> : undefined}
      />

      <Panel>
        <Metrics
          items={[
            { label: "Journeys", value: overview.journeys.length },
            { label: "Audience entries", value: entries },
            { label: "Active runs", value: activeRuns, tone: activeRuns > 0 ? "info" : "neutral" },
            { label: "Failed runs", value: overview.totals.failedExecutions, tone: overview.totals.failedExecutions > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      {canCreate ? (
        <Panel eyebrow="New journey" title="Create a journey" id="new">
          <form action={createJourneyAction.bind(null, context)} className="franchise-form journey-builder-form">
            <JourneyBuilderFields
              initial={{
                name: "",
                description: "",
                territoryId: context.territoryId ?? "",
                conditions: [],
                steps: []
              }}
              territoryOptions={territoryOptions}
            />
            <button type="submit" className="r2-button r2-button--primary">
              Create journey
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel eyebrow="Journeys" title="All journeys" id="journeys">
        {overview.journeys.length === 0 ? (
          <EmptyState title="No journeys yet">
            {canCreate ? "Create one above; it starts as a draft you can edit and approve." : "Journeys will appear here once Head Office has set one up."}
          </EmptyState>
        ) : (
          <RecordList>
            {overview.journeys.map((view) => (
              <RecordCard
                key={view.journey.id}
                title={view.journey.name}
                status={view.journey.status}
                lines={[
                  view.activeVersion ? `Version ${view.activeVersion.versionNumber}` : "No approved version yet",
                  `${formatCount(view.entries, "entry", "entries")} · ${view.activeExecutions} active · ${view.failedExecutions} failed`,
                  view.journey.description ?? "No description yet."
                ]}
              >
                {view.journey.status === "draft" || (canActivate && view.journey.status === "approved") || (canPause && (view.journey.status === "active" || view.journey.status === "approved")) ? (
                  <Actions>
                    {view.journey.status === "draft" ? (
                      <LinkButton href={`/app/journeys/${view.journey.id}` as Route} variant="secondary">
                        Open draft to edit and approve
                      </LinkButton>
                    ) : null}
                    {canActivate && view.journey.status === "approved" ? (
                      <form action={activateJourneyAction.bind(null, context, view.journey.id)}>
                        <button type="submit" className="r2-button r2-button--primary">
                          Activate
                        </button>
                      </form>
                    ) : null}
                    {canPause && (view.journey.status === "active" || view.journey.status === "approved") ? (
                      <form action={pauseJourneyAction.bind(null, context, view.journey.id)}>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Pause
                        </button>
                      </form>
                    ) : null}
                  </Actions>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadJourneys(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.journey",
      action: "view"
    });
    const context: MarketingActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const overview = await readJourneyOverview(context);
    const territoryOptions = context.territoryId
      ? (await listNetworkTerritories()).filter((territory) => territory.id === context.territoryId)
      : await listNetworkTerritories();

    const permissions = await getPermissionData();

    return {
      context,
      overview,
      territoryOptions,
      canCreate: hasMarketingCapability(permissions, context, "journeyCreate"),
      canActivate: hasMarketingCapability(permissions, context, "journeyActivate"),
      canPause: hasMarketingCapability(permissions, context, "journeyPause"),
      canHolidays: evaluatePermission({ userId: context.userId, module: "marketing.calendar", action: "manage", context: { organisationId: context.organisationId ?? undefined, territoryId: context.territoryId ?? undefined } }, permissions).allowed
    };
  } catch (error) {
    return { error };
  }
}

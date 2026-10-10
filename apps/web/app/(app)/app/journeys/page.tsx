import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasMarketingCapability, listNetworkTerritories, readJourneyOverview } from "../../../../lib/marketing-runtime";
import { formatCount } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../page";
import { JourneyBuilderFields } from "./JourneyBuilderFields";
import { journeyTemplates } from "@raring2go/marketing";
import { activateJourneyAction, createJourneyAction, createJourneyFromTemplateAction, pauseJourneyAction } from "./actions";
import type { MarketingActorContext } from "@raring2go/marketing";
import { getPermissionData } from "../../../../lib/permission-source";
import { evaluatePermission } from "@raring2go/permissions";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Journeys" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** A template's frequency-cap window in words: "30d" → "in 30 days". */
const capWindow: Record<string, string> = { lifetime: "ever", "24h": "in 24 hours", "7d": "in 7 days", "30d": "in 30 days" };

export default async function JourneysPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJourneys(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, overview, territoryOptions, canCreate, canActivate, canPause, canHolidays } = result;
  const entries = overview.journeys.reduce((total, journey) => total + journey.entries, 0);
  const activeRuns = overview.journeys.reduce((total, journey) => total + journey.activeExecutions, 0);

  return (
    <>
      <PageHeader
        eyebrow="Marketing"
        title="Journeys"
        intro="Automated email sequences for families who have opted in. Each version is approved before it runs, and you can see where runs are getting stuck."
        actions={
          canCreate || canHolidays ? (
            <>
              {canCreate ? <LinkButton href={"#new" as Route}>Create a journey</LinkButton> : null}
              {canHolidays ? (
                <LinkButton href={"/app/journeys/holidays" as Route} variant="secondary">
                  School holiday calendar
                </LinkButton>
              ) : null}
            </>
          ) : undefined
        }
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

      {canCreate ? (
        <Panel
          eyebrow="Ready-made"
          title="Start from a ready-made journey"
          intro="Reviewed copy, timing and email caps. A new one is a draft: you still review, approve and activate it before anyone is emailed."
          id="templates"
        >
          <RecordList>
            {journeyTemplates.map((template) => (
              <RecordCard
                key={template.key}
                title={template.name}
                lines={[
                  template.description,
                  `At most ${formatCount(template.frequencyCap.maxPerContact, "email")} per person ${capWindow[template.frequencyCap.window] ?? `in ${template.frequencyCap.window}`}.`
                ]}
              >
                <form action={createJourneyFromTemplateAction.bind(null, context, template.key)} className="franchise-form">
                  <label>
                    Area
                    <select name="territoryId" defaultValue={context.territoryId ?? ""}>
                      {territoryOptions.length > 0 && !context.territoryId ? <option value="">Every area</option> : null}
                      {territoryOptions.map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="r2-button r2-button--secondary">
                    Create draft
                  </button>
                </form>
              </RecordCard>
            ))}
          </RecordList>
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

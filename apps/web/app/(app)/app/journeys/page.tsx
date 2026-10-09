import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasMarketingCapability, listNetworkTerritories, readJourneyOverview } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { JourneyBuilderFields } from "./JourneyBuilderFields";
import { journeyTemplates } from "@raring2go/marketing";
import { activateJourneyAction, createJourneyAction, createJourneyFromTemplateAction, pauseJourneyAction } from "./actions";
import { StatusBadge } from "../../../../lib/workflow-ui";
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
    return protectedOutcome(result.error, request);
  }

  const { context, overview, territoryOptions, canCreate, canActivate, canPause, canHolidays } = result;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Marketing automation</p>
        <h2>Journeys</h2>
        <p>
          Consent-aware automated journeys for parents and local audiences,
          with approved versions, execution state and failure visibility.
        </p>
        {canHolidays ? <p><Link href={"/app/journeys/holidays" as Route}>School holiday calendar</Link></p> : null}
        <div className="franchise-metrics">
          <article>
            <span>Journeys</span>
            <strong>{overview.journeys.length}</strong>
          </article>
          <article>
            <span>Audience entries</span>
            <strong>{overview.journeys.reduce((total, journey) => total + journey.entries, 0)}</strong>
          </article>
          <article>
            <span>Active runs</span>
            <strong>{overview.journeys.reduce((total, journey) => total + journey.activeExecutions, 0)}</strong>
          </article>
          <article>
            <span>Failed runs</span>
            <strong>{overview.totals.failedExecutions}</strong>
          </article>
        </div>
      </section>

      {canCreate ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">New journey</p>
          <h2>Create a journey</h2>
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
            <button type="submit">Create journey</button>
          </form>
        </section>
      ) : null}

      {canCreate ? (
        <section className="app-panel franchise-panel" aria-label="Ready-made journeys">
          <p className="eyebrow">Ready-made</p>
          <h2>Start from a ready-made journey</h2>
          <p>Reviewed copy, timing and email caps. A new one is a draft: you still review, approve and activate it before anyone is emailed.</p>
          <div className="franchise-list">
            {journeyTemplates.map((template) => (
              <div key={template.key}>
                <strong>{template.name}</strong>
                <span>{template.description}</span>
                <span className="muted">At most {template.frequencyCap.maxPerContact} email{template.frequencyCap.maxPerContact === 1 ? "" : "s"} per person {template.frequencyCap.window === "lifetime" ? "ever" : `in ${template.frequencyCap.window}`}.</span>
                <form action={createJourneyFromTemplateAction.bind(null, context, template.key)} className="franchise-form">
                  <label>Area
                    <select name="territoryId" defaultValue={context.territoryId ?? ""}>
                      {territoryOptions.length > 0 && !context.territoryId ? <option value="">Every area</option> : null}
                      {territoryOptions.map((option) => (<option key={option.id} value={option.id}>{option.name}</option>))}
                    </select>
                  </label>
                  <button type="submit">Create draft</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Configured journeys</p>
        <h2>Execution health</h2>
        <div className="franchise-list">
          {overview.journeys.length === 0 ? (
            <div>
              <strong>No journeys configured</strong>
              <span>Approved journeys will appear here once automation is configured.</span>
            </div>
          ) : (
            overview.journeys.map((view) => (
              <div key={view.journey.id}>
                <strong>{view.journey.name}</strong>
                <span>
                  <StatusBadge status={view.journey.status} /> · version{" "}
                  {view.activeVersion?.versionNumber ?? "not approved"}
                </span>
                <span>
                  {view.entries} entries - {view.activeExecutions} active -{" "}
                  {view.failedExecutions} failed
                </span>
                <span>{view.journey.description ?? "No journey description provided."}</span>

                {view.journey.status === "draft" ? (
                  <span>
                    <Link href={`/app/journeys/${view.journey.id}` as Route}>Open draft to edit and approve</Link>
                  </span>
                ) : null}

                {canActivate && view.journey.status === "approved" ? (
                  <form action={activateJourneyAction.bind(null, context, view.journey.id)}>
                    <button type="submit">Activate</button>
                  </form>
                ) : null}

                {canPause && (view.journey.status === "active" || view.journey.status === "approved") ? (
                  <form action={pauseJourneyAction.bind(null, context, view.journey.id)}>
                    <button type="submit">Pause</button>
                  </form>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </AppShell>
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

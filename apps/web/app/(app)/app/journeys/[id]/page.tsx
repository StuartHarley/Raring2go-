import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasMarketingCapability, listNetworkTerritories, readJourneyDetail } from "../../../../../lib/marketing-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { JourneyBuilderFields } from "../JourneyBuilderFields";
import { activateJourneyAction, approveJourneyAction, pauseJourneyAction, updateJourneyDraftAction } from "../actions";
import type { MarketingActorContext } from "@raring2go/marketing";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JourneyDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJourney(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, detail, territoryOptions, canEdit, canApprove, canActivate, canPause } = result;
  const { journey, latestVersion } = detail;
  const isDraft = journey.status === "draft";

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Journeys", href: "/app/journeys" }, { label: journey.name }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Journey</p>
        <h2>{journey.name}</h2>
        <p>{journey.description ?? "No journey description provided."}</p>
        <div className="franchise-metrics">
          <article>
            <span>Status</span>
            <strong>{journey.status}</strong>
          </article>
          <article>
            <span>Version</span>
            <strong>{latestVersion?.versionNumber ?? "-"}</strong>
          </article>
          <article>
            <span>Entries</span>
            <strong>{detail.entries}</strong>
          </article>
          <article>
            <span>Active runs</span>
            <strong>{detail.activeExecutions}</strong>
          </article>
          <article>
            <span>Failed runs</span>
            <strong>{detail.failedExecutions}</strong>
          </article>
        </div>

        <div className="franchise-actions">
          {canApprove && isDraft && latestVersion ? (
            <form action={approveJourneyAction.bind(null, context, journey.id, latestVersion.id)}>
              <button type="submit">Approve this version</button>
            </form>
          ) : null}
          {canActivate && journey.status === "approved" ? (
            <form action={activateJourneyAction.bind(null, context, journey.id)}>
              <button type="submit">Activate</button>
            </form>
          ) : null}
          {canPause && (journey.status === "active" || journey.status === "approved") ? (
            <form action={pauseJourneyAction.bind(null, context, journey.id)}>
              <button type="submit">Pause</button>
            </form>
          ) : null}
        </div>
      </section>

      {isDraft && latestVersion ? (
        canEdit ? (
          <section className="app-panel franchise-panel">
            <p className="eyebrow">Draft</p>
            <h2>Edit journey</h2>
            <form action={updateJourneyDraftAction.bind(null, context, journey.id)} className="franchise-form journey-builder-form">
              <JourneyBuilderFields
                initial={{
                  name: journey.name,
                  description: journey.description ?? "",
                  territoryId: journey.territoryId ?? "",
                  conditions: latestVersion.conditions,
                  steps: latestVersion.steps
                }}
                territoryOptions={territoryOptions}
              />
              <button type="submit">Save changes</button>
            </form>
          </section>
        ) : (
          <p className="franchise-readonly">This draft is read-only in the current context.</p>
        )
      ) : latestVersion ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Approved content</p>
          <h2>Steps</h2>
          <p>
            This journey is {journey.status} - its approved content can no longer be edited. Pause and create a
            replacement journey to make changes.
          </p>
          <ol className="franchise-activity">
            {latestVersion.steps.map((step, index) => (
              <li key={step.key}>
                <strong>Step {index + 1}: {step.email.subject}</strong>
                <span>{index === 0 ? "Runs immediately on entry" : `Waits ${step.delayMinutes} minute(s) after the previous step`}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </AppShell>
  );
}

async function loadJourney(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
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
    const detail = await readJourneyDetail(context, id);
    const territoryOptions = context.territoryId
      ? listNetworkTerritories().filter((territory) => territory.id === context.territoryId)
      : listNetworkTerritories();

    return {
      context,
      detail,
      territoryOptions,
      canEdit: hasMarketingCapability(context, "journeyEdit"),
      canApprove: hasMarketingCapability(context, "journeyApprove"),
      canActivate: hasMarketingCapability(context, "journeyActivate"),
      canPause: hasMarketingCapability(context, "journeyPause")
    };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-outcome app-outcome-unauthorised">
      <section>
        <p className="eyebrow">Access denied</p>
        <h1>Journey not available</h1>
        <p>{error instanceof Error ? error.message : "This journey is not available."}</p>
      </section>
    </main>
  );
}

import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasMarketingCapability, listNetworkTerritories, readJourneyDetail } from "../../../../../lib/marketing-runtime";
import { formatLabel } from "../../../../../lib/format";
import { Metrics, Notice, PageHeader, Panel, toneForStatus } from "../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { JourneyBuilderFields } from "../JourneyBuilderFields";
import { activateJourneyAction, approveJourneyAction, pauseJourneyAction, updateJourneyDraftAction } from "../actions";
import type { MarketingActorContext } from "@raring2go/marketing";
import { getPermissionData } from "../../../../../lib/permission-source";
import { recordOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Journey" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function JourneyDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadJourney(request, id);

  if ("error" in result) {
    return recordOutcome(result.error, request);
  }

  const { context, detail, territoryOptions, canEdit, canApprove, canActivate, canPause } = result;
  const { journey, latestVersion } = detail;
  const isDraft = journey.status === "draft";
  const showApprove = canApprove && isDraft && latestVersion;
  const showActivate = canActivate && journey.status === "approved";
  const showPause = canPause && (journey.status === "active" || journey.status === "approved");

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Journeys", href: "/app/journeys" }, { label: journey.name }]} />

      <PageHeader
        eyebrow="Journey"
        title={journey.name}
        intro={journey.description ?? "No description yet."}
        actions={
          showApprove || showActivate || showPause ? (
            <>
              {showApprove ? (
                <form action={approveJourneyAction.bind(null, context, journey.id, latestVersion.id)}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Approve this version
                  </button>
                </form>
              ) : null}
              {showActivate ? (
                <form action={activateJourneyAction.bind(null, context, journey.id)}>
                  <button type="submit" className="r2-button r2-button--primary">
                    Activate
                  </button>
                </form>
              ) : null}
              {showPause ? (
                <form action={pauseJourneyAction.bind(null, context, journey.id)}>
                  <button type="submit" className="r2-button r2-button--secondary">
                    Pause
                  </button>
                </form>
              ) : null}
            </>
          ) : undefined
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Status", value: formatLabel(journey.status), tone: toneForStatus(journey.status) },
            { label: "Version", value: latestVersion?.versionNumber ?? "None yet" },
            { label: "Entries", value: detail.entries },
            { label: "Active runs", value: detail.activeExecutions, tone: detail.activeExecutions > 0 ? "info" : "neutral" },
            { label: "Failed runs", value: detail.failedExecutions, tone: detail.failedExecutions > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      {isDraft && latestVersion ? (
        canEdit ? (
          <Panel eyebrow="Draft" title="Edit journey" id="edit">
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
              <button type="submit" className="r2-button r2-button--primary">
                Save changes
              </button>
            </form>
          </Panel>
        ) : (
          <Panel eyebrow="Draft" title="Edit journey">
            <Notice tone="info">This draft is read-only in your current working context.</Notice>
          </Panel>
        )
      ) : latestVersion ? (
        <Panel
          eyebrow="Approved content"
          title="Steps"
          intro={`This journey is ${formatLabel(journey.status).toLowerCase()}, so its approved content can no longer be edited. Pause it and create a replacement journey to make changes.`}
          id="steps"
        >
          <ol className="franchise-activity">
            {latestVersion.steps.map((step, index) => (
              <li key={step.key}>
                <strong>
                  Step {index + 1}: {step.email.subject}
                </strong>
                <span>{index === 0 ? "Runs immediately on entry" : `Waits ${step.delayMinutes} minute(s) after the previous step`}</span>
              </li>
            ))}
          </ol>
        </Panel>
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
      ? (await listNetworkTerritories()).filter((territory) => territory.id === context.territoryId)
      : await listNetworkTerritories();

    const permissions = await getPermissionData();

    return {
      context,
      detail,
      territoryOptions,
      canEdit: hasMarketingCapability(permissions, context, "journeyEdit"),
      canApprove: hasMarketingCapability(permissions, context, "journeyApprove"),
      canActivate: hasMarketingCapability(permissions, context, "journeyActivate"),
      canPause: hasMarketingCapability(permissions, context, "journeyPause")
    };
  } catch (error) {
    return { error };
  }
}

import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { listNetworkTerritories, readNewsletterFactoryOverview, readSegments } from "../../../../../lib/marketing-runtime";
import { displayName, formatCount, formatLabel } from "../../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import {
  addEditionOverrideAction,
  approveMasterAction,
  createCampaignFromEditionAction,
  createNewsletterMasterAction,
  generateEditionsAction
} from "../actions";
import type { AudienceSegment } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Newsletter factory" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewsletterFactoryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadFactory(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, factory, territories, segments, isNetworkView } = result;

  return (
    <>
      <PageHeader
        eyebrow="Head Office"
        title="Newsletter factory"
        intro="Write one newsletter at Head Office, generate an edition for each area, and keep each area's local additions separate from the master."
        actions={
          <>
            {isNetworkView ? <LinkButton href={"#new-master" as Route}>Create a master</LinkButton> : null}
            <LinkButton href={"/app/newsletters" as Route} variant="secondary">
              Newsletters
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Masters", value: factory.totals.masters },
            { label: "Area editions", value: factory.totals.editions },
            { label: "Ready to send", value: factory.totals.ready, tone: factory.totals.ready > 0 ? "success" : "neutral" },
            { label: "Needs review", value: factory.totals.needsReview, tone: factory.totals.needsReview > 0 ? "warning" : "neutral" },
            { label: "Blocked", value: factory.totals.blocked, tone: factory.totals.blocked > 0 ? "danger" : "success" }
          ]}
        />
      </Panel>

      {isNetworkView ? (
        <Panel eyebrow="New master" title="Create a newsletter master" id="new-master">
          <form action={createNewsletterMasterAction.bind(null, context)} className="franchise-form">
            <label>
              Title
              <input type="text" name="title" required />
            </label>
            <label>
              Season
              <input type="text" name="seasonKey" placeholder="e.g. autumn" />
            </label>
            <label>
              <input type="checkbox" name="requireLocalContent" /> Require each area to add local picks before sending
            </label>
            <button type="submit" className="r2-button r2-button--primary">
              Create master
            </button>
          </form>
        </Panel>
      ) : null}

      <Panel eyebrow="Masters" title="Network masters" id="masters">
        {factory.masters.length === 0 ? (
          <EmptyState title="No masters yet">
            {isNetworkView ? "Create a master above and approve it to generate area editions." : "Approved Head Office masters will appear here."}
          </EmptyState>
        ) : (
          <RecordList>
            {factory.masters.map((master) => (
              <RecordCard
                key={master.id}
                title={master.title}
                status={master.status}
                lines={[
                  master.seasonKey ? `${formatLabel(master.seasonKey)} season` : "No season set",
                  formatCount(master.localEditableBlocks.length, "block areas can edit locally", "blocks areas can edit locally")
                ]}
              >
                {isNetworkView && master.status === "draft" ? (
                  <form action={approveMasterAction.bind(null, context, master.id)}>
                    <Actions>
                      <button type="submit" className="r2-button r2-button--primary">
                        Approve master
                      </button>
                    </Actions>
                  </form>
                ) : null}
                {isNetworkView && (master.status === "approved" || master.status === "generated") ? (
                  <form action={generateEditionsAction.bind(null, context, master.id)} className="franchise-form">
                    {territories.map((territory) => (
                      <label key={territory.id}>
                        <input type="checkbox" name="territoryIds" value={territory.id} defaultChecked /> {territory.name}
                      </label>
                    ))}
                    <button type="submit" className="r2-button r2-button--primary">
                      Generate area editions
                    </button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Area editions" title="Local readiness" id="editions">
        {factory.editions.length === 0 ? (
          <EmptyState title="No editions generated yet">Approve a master and generate its editions to see the readiness of each area here.</EmptyState>
        ) : (
          <RecordList>
            {factory.editions.map((edition) => {
              const segment = segments.find((candidate) => candidate.territoryId === edition.territoryId);
              const canEdit = !context.territoryId || context.territoryId === edition.territoryId;

              return (
                <RecordCard
                  key={edition.id}
                  title={territoryName(territories, edition.territoryId)}
                  status={edition.status}
                  lines={[
                    `${formatCount(edition.warnings.length, "warning")} · ${formatCount(Object.keys(edition.localOverrides).length, "local override")}`,
                    edition.emailCampaignId ? (
                      <>
                        A campaign has been created from this edition - manage sending from <Link href={"/app/newsletters" as Route}>Newsletters</Link>
                      </>
                    ) : null,
                    !edition.emailCampaignId && canEdit && edition.status !== "blocked" && !segment
                      ? "No audience segment is configured for this area yet."
                      : null
                  ]}
                >
                  {!edition.emailCampaignId && canEdit ? (
                    <form action={addEditionOverrideAction.bind(null, context, edition.id)} className="franchise-form">
                      <label>
                        Local picks (one per line)
                        <textarea name="localPicks" rows={3} />
                      </label>
                      <button type="submit" className="r2-button r2-button--secondary">
                        Save local content
                      </button>
                    </form>
                  ) : null}
                  {!edition.emailCampaignId && canEdit && edition.status !== "blocked" && segment ? (
                    <form action={createCampaignFromEditionAction.bind(null, context, edition.id, segment.id)} className="franchise-form">
                      <label>
                        Subject
                        <input type="text" name="subject" required />
                      </label>
                      <label>
                        Preheader
                        <input type="text" name="preheader" />
                      </label>
                      <button type="submit" className="r2-button r2-button--primary">
                        Create campaign from this edition
                      </button>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadFactory(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.newsletter_factory",
      action: "view"
    });
    const context: MarketingActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const [factory, segments] = await Promise.all([
      readNewsletterFactoryOverview(context),
      readSegments(context).catch(() => [] as AudienceSegment[])
    ]);

    return {
      context,
      factory,
      segments,
      isNetworkView: !context.territoryId,
      territories: await listNetworkTerritories()
    };
  } catch (error) {
    return { error };
  }
}

function territoryName(territories: Array<{ id: string; name: string }>, territoryId: string) {
  return displayName(territories.find((territory) => territory.id === territoryId)?.name, "Area not named yet");
}

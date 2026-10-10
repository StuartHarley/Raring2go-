import { requireShellPermission } from "../../../../../lib/app-shell";
import { listNetworkTerritories, readSegmentsWithAudienceCounts } from "../../../../../lib/marketing-runtime";
import { formatCount } from "../../../../../lib/format";
import { EmptyState, PageHeader, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { requestFromSearchParamsAndCookies } from "../../page";
import { SegmentRuleBuilder } from "./SegmentRuleBuilder";
import { createSegmentAction, previewSegmentAudienceAction, updateSegmentAction } from "./actions";
import type { SegmentRuleGroup } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Segments" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const EMPTY_ROOT: SegmentRuleGroup = { kind: "group", match: "all", children: [] };

export default async function SegmentsPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadSegments(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, segments, territoryOptions } = result;

  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Segments"
        intro="Reusable groups of contacts built from rules such as area, subscription status, tags, consent, interests and recent activity, with a live count as you edit."
      />

      <Panel eyebrow="New segment" title="Create a segment">
        <form action={createSegmentAction.bind(null, context)} className="franchise-form segment-builder-form">
          <label>
            Key
            <input type="text" name="key" placeholder="e.g. sutton-vip-parents" required />
          </label>
          <label>
            Name
            <input type="text" name="name" placeholder="e.g. Sutton VIP parents" required />
          </label>
          <div className="segment-builder-field">
            <SegmentRuleBuilder
              initialRoot={EMPTY_ROOT}
              territoryOptions={territoryOptions}
              defaultTerritoryId={context.territoryId ?? null}
              previewAction={previewSegmentAudienceAction}
            />
          </div>
          <button type="submit" className="r2-button r2-button--primary">
            Create segment
          </button>
        </form>
      </Panel>

      <Panel eyebrow="Existing segments" title="Saved segments">
        {segments.length === 0 ? (
          <EmptyState title="No segments yet">Create one above and it will appear here with how many people it reaches.</EmptyState>
        ) : (
          <RecordList>
            {segments.map(({ segment, recipientCount }) => (
              <RecordCard
                key={segment.id}
                title={segment.name}
                status={segment.status}
                lines={[`${segment.key} · ${formatCount(recipientCount, "recipient")}${segment.territoryId ? "" : " · National"}`]}
              >
                {segment.segmentType === "dynamic" ? (
                  <details>
                    <summary>Edit the rules</summary>
                    <form action={updateSegmentAction.bind(null, context, segment.id)} className="franchise-form segment-builder-form">
                      <label>
                        Name
                        <input type="text" name="name" defaultValue={segment.name} required />
                      </label>
                      <div className="segment-builder-field">
                        <SegmentRuleBuilder
                          initialRoot={normalizeForEditing(segment.definition)}
                          territoryOptions={segment.territoryId ? territoryOptions.filter((option) => option.id === segment.territoryId) : territoryOptions}
                          defaultTerritoryId={segment.territoryId ?? null}
                          previewAction={previewSegmentAudienceAction}
                        />
                      </div>
                      <button type="submit" className="r2-button r2-button--secondary">
                        Save changes
                      </button>
                    </form>
                  </details>
                ) : (
                  <p>This is a static segment and can&apos;t be edited here.</p>
                )}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

function normalizeForEditing(definition: Record<string, unknown>): SegmentRuleGroup {
  if (definition.version === 1 && isGroup(definition.root)) {
    return definition.root;
  }
  return EMPTY_ROOT;
}

function isGroup(value: unknown): value is SegmentRuleGroup {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === "group";
}

async function loadSegments(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.segment",
      action: "view"
    });
    const context: MarketingActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const segments = await readSegmentsWithAudienceCounts(context);
    const territoryOptions = context.territoryId
      ? (await listNetworkTerritories()).filter((territory) => territory.id === context.territoryId)
      : await listNetworkTerritories();

    return { context, segments, territoryOptions };
  } catch (error) {
    return { error };
  }
}

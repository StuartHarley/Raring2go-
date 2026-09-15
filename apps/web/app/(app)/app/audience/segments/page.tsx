import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { listNetworkTerritories, readSegmentsWithAudienceCounts } from "../../../../../lib/marketing-runtime";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { SegmentRuleBuilder } from "./SegmentRuleBuilder";
import { createSegmentAction, previewSegmentAudienceAction, updateSegmentAction } from "./actions";
import type { SegmentRuleGroup } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";

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
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Audience</p>
        <h2>Segment builder</h2>
        <p>
          Build a reusable audience rule with nested AND/OR conditions — territory, subscription status, tags,
          consent, interests and recent activity — with a live count as you edit.
        </p>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">New segment</p>
        <h2>Create a segment</h2>
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
          <button type="submit">Create segment</button>
        </form>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Existing segments</p>
        <h2>Segments</h2>
        {segments.length === 0 ? (
          <p>No segments yet. Create one above to get started.</p>
        ) : (
          <div className="franchise-list">
            {segments.map(({ segment, recipientCount }) => (
              <details key={segment.id}>
                <summary>
                  <strong>{segment.name}</strong>
                  <span>
                    {segment.key} - {recipientCount} recipient{recipientCount === 1 ? "" : "s"}
                    {segment.territoryId ? "" : " (national)"}
                  </span>
                </summary>
                {segment.segmentType === "dynamic" ? (
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
                    <button type="submit">Save changes</button>
                  </form>
                ) : (
                  <p>This is a static segment and can&apos;t be edited here.</p>
                )}
              </details>
            ))}
          </div>
        )}
      </section>
    </AppShell>
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
      ? listNetworkTerritories().filter((territory) => territory.id === context.territoryId)
      : listNetworkTerritories();

    return { context, segments, territoryOptions };
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

  throw error;
}

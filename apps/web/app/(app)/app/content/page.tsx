import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { formatCount, formatLabel, formatLabels } from "../../../../lib/format";
import { EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { hasContentAiCapability, listContentLibraryItems } from "../../../../lib/publishing-runtime";
import { requestFromSearchParamsAndCookies } from "../page";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Content Studio" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentLibraryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadContent(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const needsAttention = result.items.filter((item) => item.health.length > 0).length;
  const sponsored = result.items.filter((item) => item.item.advertiserId || item.item.commercialBookingId).length;
  const localised = result.items.filter((item) => item.localisations.length > 0).length;

  return (
    <>
      <PageHeader
        eyebrow="Publishing"
        title="Content Studio"
        intro="Write a story once, then localise it, repurpose it for each channel and review the variants, with the original always traceable."
        actions={result.canUseAi ? <LinkButton href={"/app/content/new" as Route}>Draft with AI</LinkButton> : undefined}
      />

      <Panel>
        <Metrics
          items={[
            { label: "Items", value: result.items.length },
            { label: "Needs attention", value: needsAttention, tone: needsAttention > 0 ? "warning" : "success" },
            { label: "Sponsored", value: sponsored },
            { label: "Localised", value: localised }
          ]}
        />
      </Panel>

      <Panel eyebrow="Library" title="Source content">
        {result.items.length === 0 ? (
          <EmptyState title="No content yet" action={result.canUseAi ? <LinkButton href={"/app/content/new" as Route} variant="secondary">Draft the first piece with AI</LinkButton> : undefined}>
            Stories, events, offers and competitions you create will appear here.
          </EmptyState>
        ) : (
          <RecordList>
            {result.items.map((item) => (
              <RecordLink
                key={item.item.id}
                href={`/app/content/${item.item.id}` as Route}
                title={item.item.title}
                status={item.item.status}
                lines={[
                  `${formatLabel(item.item.contentType)} · ${item.item.ownerLevel === "network" ? "Network content" : "Local content"}`,
                  `${formatCount(item.variants.length, "channel variant")} · Edition: ${formatLabel(item.editionStatus)}`,
                  item.health.length === 0 ? "Healthy" : `Needs attention: ${formatLabels(item.health)}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadContent(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "content",
      action: "view"
    });
    const actor = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const items = await listContentLibraryItems(actor);

    const canHomepage = await requireShellPermission(request, { module: "public.homepage", action: "manage" }).then(() => true, (error) => {
      if (error instanceof ShellAccessError) return false;
      throw error;
    });

    return { items, canUseAi: hasContentAiCapability(await getPermissionData(), actor), canHomepage };
  } catch (error) {
    return { error };
  }
}

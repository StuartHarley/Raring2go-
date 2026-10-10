import Link from "next/link";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasContentAiCapability, readContentWorkspaceView } from "../../../../../lib/publishing-runtime";
import { getDirectory } from "../../../../../lib/directory";
import { displayName, formatCount, formatLabel, formatLabels } from "../../../../../lib/format";
import { EmptyState, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList, toneForStatus } from "../../../../../lib/page-ui";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveVariantAction, generateContentDraftAction, repurposeContentAction } from "../actions";
import { RepurposeForm } from "../RepurposeForm";
import { CompetitionPanel } from "./CompetitionPanel";
import { ContentDraftForm } from "../ContentDraftForm";
import { getPermissionData } from "../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Content" };

const channels = ["magazine", "website", "newsletter", "facebook", "instagram", "linkedin"];
const socialChannels = ["facebook", "instagram", "linkedin"];

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentWorkspacePage({ params, searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultCode = Array.isArray(search.result) ? search.result[0] : search.result;
  const { id } = await params;
  const result = await loadWorkspace(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { libraryItem, versions, variantVersions, aiTasks, websiteJobs } = result.workspace;
  const directory = getDirectory();
  const territoryNames = new Map(
    await Promise.all(
      libraryItem.localisations.map(async (localisation) => [localisation.territoryId, await directory.territoryName(localisation.territoryId)] as const)
    )
  );
  const aiTaskById = new Map(aiTasks.map((task) => [task.id, task]));

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[
        { label: "Content Studio", href: "/app/content" as Route },
        { label: libraryItem.item.title }
      ]} />
      <PageHeader
        eyebrow={`${formatLabel(libraryItem.item.contentType)} · ${libraryItem.item.ownerLevel === "network" ? "Network content" : "Local content"}`}
        title={libraryItem.item.title}
        intro={libraryItem.item.standfirst || "No standfirst yet."}
      />

      <Panel>
        <Metrics
          items={[
            { label: "Status", value: formatLabel(libraryItem.item.status), tone: toneForStatus(libraryItem.item.status) },
            { label: "Versions", value: versions.length },
            { label: "AI tasks", value: aiTasks.length },
            { label: "Localisations", value: libraryItem.localisations.length },
            { label: "Website jobs", value: websiteJobs.length }
          ]}
        />
      </Panel>

      {libraryItem.item.contentType === "competition" ? <CompetitionPanel request={request} contentId={libraryItem.item.id} resultCode={resultCode} /> : null}

      {libraryItem.item.status === "draft" && result.canUseAi ? (
        <Panel
          eyebrow="AI"
          title="Revise this draft with AI"
          intro="Describe the change. You review the result before it becomes a new draft version; approved and published content is never changed this way."
        >
          <ContentDraftForm action={generateContentDraftAction.bind(null, request, libraryItem.item.id)} revising defaultType={libraryItem.item.contentType} />
        </Panel>
      ) : null}

      {["approved", "published"].includes(libraryItem.item.status) && result.canUseAi ? (
        <Panel eyebrow="AI" title="Repurpose this article" intro="Write channel variants from the approved source. Each one is reviewed before it is approved.">
          <RepurposeForm action={repurposeContentAction.bind(null, request, libraryItem.item.id)} />
        </Panel>
      ) : null}

      <Panel eyebrow="Channel variants" title="Variants and approval">
        {libraryItem.variants.length === 0 ? (
          <EmptyState title="No variants yet">Channel variants appear here once the article is repurposed for a channel.</EmptyState>
        ) : (
          <RecordList>
            {libraryItem.variants.map((variant) => {
              const current = variantVersions.find((version) => version.id === variant.currentVersionId);
              const unsupported = Array.isArray(current?.provenance.unsupportedFacts) ? (current!.provenance.unsupportedFacts as string[]) : [];
              // JSONB does not keep key order, so preview the longest text field rather than the first.
              const preview = current ? Object.values(current.snapshot).filter((value): value is string => typeof value === "string").sort((a, b) => b.length - a.length)[0] : undefined;
              return (
                <RecordCard
                  key={variant.id}
                  title={formatLabel(variant.channel)}
                  status={variant.status}
                  lines={[
                    typeof preview === "string" ? `${preview.slice(0, 220)}${preview.length > 220 ? "…" : ""}` : null,
                    <>
                      {current?.provenance.generatedBy === "ai" ? `AI draft from "${libraryItem.item.title}"` : "Source: this article"}
                      {current?.provenance.aiRunId ? <> · <Link href={`/app/system/ai/${String(current.provenance.aiRunId)}` as Route}>AI run</Link></> : null}
                    </>
                  ]}
                >
                  {unsupported.length > 0 ? (
                    <Notice tone="warning">Check before approving: not found in the source — {unsupported.join(", ")}</Notice>
                  ) : null}
                  {["ai_draft", "needs_review"].includes(variant.status) && result.canUseAi ? (
                    <form action={approveVariantAction.bind(null, request, libraryItem.item.id, variant.id)}>
                      <button type="submit" className="r2-button r2-button--secondary">Approve this variant</button>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>

      <RelatedRecords
        title="Editorial distribution"
        records={[
          {
            label: "Edition",
            title: formatCount(libraryItem.localisations.length, "territory derivation"),
            description: "Magazine placement and local override context",
            href: "/app/editions"
          },
          {
            label: "Website",
            title: formatCount(websiteJobs.length, "publishing job"),
            description: "Website-ready state from approved content variants"
          },
          {
            label: "Newsletter",
            title: formatCount(libraryItem.variants.filter((variant) => variant.channel === "newsletter").length, "newsletter variant"),
            description: "Reusable blocks for network or local newsletters",
            href: "/app/newsletters"
          },
          {
            label: "Social",
            title: formatCount(libraryItem.variants.filter((variant) => socialChannels.includes(variant.channel)).length, "social variant"),
            description: "Approved social variants feed the publishing queue",
            href: "/app/social"
          }
        ]}
      />

      <Panel eyebrow="Channels" title="Where this content is going">
        <Metrics
          items={channels.map((channel) => {
            const variant = libraryItem.variants.find((candidate) => candidate.channel === channel);
            return {
              label: formatLabel(channel),
              value: variant ? formatLabel(variant.status) : "Not created",
              tone: variant ? toneForStatus(variant.status) : undefined
            };
          })}
        />
      </Panel>

      <Panel eyebrow="Social queue" title="Social variants" intro="Approved social variants are scheduled from the Social queue.">
        <RecordList>
          {socialChannels.map((channel) => {
            const variant = libraryItem.variants.find((candidate) => candidate.channel === channel);
            return (
              <RecordCard
                key={channel}
                title={formatLabel(channel)}
                status={variant?.status ?? "not_created"}
                lines={[variant?.status === "approved" ? "Ready to add to the Social queue." : "Review and approve the variant first."]}
              >
                {variant?.status === "approved" ? <Link href={"/app/social" as Route}>Open the Social queue</Link> : null}
              </RecordCard>
            );
          })}
        </RecordList>
      </Panel>

      <Panel eyebrow="Network distribution" title="Territory derivations">
        {libraryItem.localisations.length === 0 ? (
          <EmptyState title="No territory derivations">Network distribution creates controlled local records rather than unrelated copies.</EmptyState>
        ) : (
          <RecordList>
            {libraryItem.localisations.map((localisation) => (
              <RecordCard
                key={localisation.id}
                title={displayName(territoryNames.get(localisation.territoryId), "Territory not named")}
                status={localisation.state}
                lines={[
                  `From master version ${localisation.masterVersionNumber}`,
                  `Locked: ${localisation.lockedFields.length ? formatLabels(localisation.lockedFields) : "none"} · Editable: ${localisation.editableFields.length ? formatLabels(localisation.editableFields) : "none"}`
                ]}
              />
            ))}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Provenance" title="AI and version history">
        {variantVersions.length === 0 ? (
          <EmptyState title="No variant versions yet">Each AI draft or edit of a channel variant is recorded here.</EmptyState>
        ) : (
          <RecordList>
            {variantVersions.map((version) => {
              const task = version.generatedByTaskId ? aiTaskById.get(version.generatedByTaskId) : undefined;
              return (
                <RecordCard
                  key={version.id}
                  title={`Variant version ${version.versionNumber}`}
                  status={version.status}
                  lines={[
                    task
                      ? `Generated by AI (${formatLabel(task.task)}, ${formatLabel(task.status).toLowerCase()})`
                      : version.generatedByTaskId
                        ? "Generated by an AI task"
                        : "Created without AI"
                  ]}
                />
              );
            })}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

async function loadWorkspace(
  request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>,
  contentItemId: string
) {
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
    const workspace = await readContentWorkspaceView(actor, contentItemId);

    return { workspace, canUseAi: hasContentAiCapability(await getPermissionData(), actor) };
  } catch (error) {
    return { error };
  }
}

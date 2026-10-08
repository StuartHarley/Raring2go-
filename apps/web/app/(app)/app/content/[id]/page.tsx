import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasContentAiCapability, readContentWorkspaceView } from "../../../../../lib/publishing-runtime";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { approveVariantAction, generateContentDraftAction, repurposeContentAction } from "../actions";
import { RepurposeForm } from "../RepurposeForm";
import { ContentDraftForm } from "../ContentDraftForm";
import { getPermissionData } from "../../../../../lib/permission-source";

const channels = ["magazine", "website", "newsletter", "facebook", "instagram", "linkedin"];

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentWorkspacePage({ params, searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const { id } = await params;
  const result = await loadWorkspace(request, id);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { libraryItem, versions, variantVersions, aiTasks, websiteJobs } = result.workspace;

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[
        { label: "Publishing", href: "/app/content" },
        { label: "Content Studio", href: "/app/content" },
        { label: libraryItem.item.title }
      ]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Source</p>
        <h2>{libraryItem.item.title}</h2>
        <p>{libraryItem.item.standfirst}</p>
        <div className="franchise-metrics">
          <article>
            <span>Versions</span>
            <strong>{versions.length}</strong>
          </article>
          <article>
            <span>AI tasks</span>
            <strong>{aiTasks.length}</strong>
          </article>
          <article>
            <span>Localisations</span>
            <strong>{libraryItem.localisations.length}</strong>
          </article>
          <article>
            <span>Website jobs</span>
            <strong>{websiteJobs.length}</strong>
          </article>
        </div>
      </section>

      {libraryItem.item.status === "draft" && result.canUseAi ? (
        <section className="app-panel franchise-panel" aria-label="Revise with AI">
          <p className="eyebrow">AI</p>
          <h2>Revise this draft with AI</h2>
          <p>Describe the change. You will review the result before it becomes a new draft version; approved and published content is never changed this way.</p>
          <ContentDraftForm action={generateContentDraftAction.bind(null, request, libraryItem.item.id)} revising defaultType={libraryItem.item.contentType} />
        </section>
      ) : null}

      {["approved", "published"].includes(libraryItem.item.status) && result.canUseAi ? (
        <section className="app-panel franchise-panel" aria-label="Repurpose with AI">
          <p className="eyebrow">AI</p>
          <h2>Repurpose this article</h2>
          <RepurposeForm action={repurposeContentAction.bind(null, request, libraryItem.item.id)} />
        </section>
      ) : null}

      <section className="app-panel franchise-panel" aria-label="Variants">
        <p className="eyebrow">Channel variants</p>
        <h2>Variants and approval</h2>
        <div className="franchise-list">
          {libraryItem.variants.length === 0 ? (
            <div>
              <strong>No variants yet.</strong>
            </div>
          ) : (
            libraryItem.variants.map((variant) => {
              const current = variantVersions.find((version) => version.id === variant.currentVersionId);
              const unsupported = Array.isArray(current?.provenance.unsupportedFacts) ? (current!.provenance.unsupportedFacts as string[]) : [];
              // JSONB does not keep key order, so preview the longest text field rather than the first.
              const preview = current ? Object.values(current.snapshot).filter((value): value is string => typeof value === "string").sort((a, b) => b.length - a.length)[0] : undefined;
              return (
                <div key={variant.id}>
                  <strong>{variant.channel} · {variant.status.replace("_", " ")}</strong>
                  {typeof preview === "string" ? <span>{preview.slice(0, 220)}{preview.length > 220 ? "…" : ""}</span> : null}
                  <span>
                    {current?.provenance.generatedBy === "ai" ? `AI draft from "${libraryItem.item.title}"` : "Source: this article"}
                    {current?.provenance.aiRunId ? <> · <Link href={`/app/system/ai/${String(current.provenance.aiRunId)}` as Route}>AI run</Link></> : null}
                  </span>
                  {unsupported.length > 0 ? (
                    <span role="note" className="notice notice--error">Check before approving: not found in the source — {unsupported.join(", ")}</span>
                  ) : null}
                  {["ai_draft", "needs_review"].includes(variant.status) && result.canUseAi ? (
                    <form action={approveVariantAction.bind(null, request, libraryItem.item.id, variant.id)}>
                      <button type="submit">Approve this variant</button>
                    </form>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <RelatedRecords
        title="Editorial distribution"
        records={[
          {
            label: "Edition",
            title: `${libraryItem.localisations.length} territory derivation(s)`,
            description: "Magazine placement and local override context",
            href: "/app/editions"
          },
          {
            label: "Website",
            title: `${websiteJobs.length} publishing job(s)`,
            description: "Website-ready state from approved content variants"
          },
          {
            label: "Newsletter",
            title: `${libraryItem.variants.filter((variant) => variant.channel === "newsletter").length} newsletter variant(s)`,
            description: "Reusable blocks for network or local newsletters",
            href: "/app/newsletters"
          },
          {
            label: "Social",
            title: `${libraryItem.variants.filter((variant) => ["facebook", "instagram", "linkedin"].includes(variant.channel)).length} social variant(s)`,
            description: "Approved social variants feed the publishing queue",
            href: "/app/social"
          }
        ]}
      />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Channels</p>
        <h2>Repurpose everywhere</h2>
        <div className="franchise-metrics">
          {channels.map((channel) => {
            const variant = libraryItem.variants.find((candidate) => candidate.channel === channel);
            return (
              <article key={channel}>
                <span>{channel}</span>
                <strong>{variant?.status.replace("_", " ") ?? "Not created"}</strong>
              </article>
            );
          })}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Social queue</p>
        <h2>Approved social variants</h2>
        <div className="franchise-list">
          {["facebook", "instagram", "linkedin"].map((channel) => {
            const variant = libraryItem.variants.find((candidate) => candidate.channel === channel);
            return (
              <div key={channel}>
                <strong>{channel}</strong>
                <span>{variant?.status === "approved" ? `Add ${channel} to queue` : "Review and approve variant first"}</span>
                <span>MKT-005 schedules approved variants through /app/social.</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Network distribution</p>
        <h2>Territory derivations</h2>
        <div className="franchise-list">
          {libraryItem.localisations.length === 0 ? (
            <div>
              <strong>No territory derivations</strong>
              <span>Network distribution creates controlled local records rather than unrelated copies.</span>
            </div>
          ) : (
            libraryItem.localisations.map((localisation) => (
              <div key={localisation.id}>
                <strong>{localisation.territoryId}</strong>
                <span>{localisation.state.replace("_", " ")} - master v{localisation.masterVersionNumber}</span>
                <span>Locked: {localisation.lockedFields.join(", ") || "none"} - editable: {localisation.editableFields.join(", ") || "none"}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Provenance</p>
        <h2>AI and version history</h2>
        <div className="franchise-list">
          {variantVersions.map((version) => (
            <div key={version.id}>
              <strong>Variant version {version.versionNumber}</strong>
              <span>{version.status} - generated task {version.generatedByTaskId ?? "none"}</span>
            </div>
          ))}
        </div>
      </section>
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

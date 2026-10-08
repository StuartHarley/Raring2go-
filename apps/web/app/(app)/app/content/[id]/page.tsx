import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasContentAiCapability, readContentWorkspaceView } from "../../../../../lib/publishing-runtime";
import { Breadcrumbs, RelatedRecords } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { generateContentDraftAction } from "../actions";
import { ContentDraftForm } from "../ContentDraftForm";

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

    return { workspace, canUseAi: hasContentAiCapability(actor) };
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

import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import { hasContentAiCapability } from "../../../../../lib/publishing-runtime";
import { Breadcrumbs } from "../../../../../lib/workflow-ui";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { generateContentDraftAction } from "../actions";
import { ContentDraftForm } from "../ContentDraftForm";
import { getPermissionData } from "../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../lib/protected-outcome";

export const metadata = { title: "Draft content with AI" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function NewAiContentPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  let canUseAi = false;

  try {
    // Route gate is content.view; content.ai.generate (and create/edit) are enforced by the
    // runtime when the draft is requested and accepted, against the publishing permission data.
    const shell = await requireShellPermission(request, { module: "content", action: "view" });
    canUseAi = hasContentAiCapability(await getPermissionData(), { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    return protectedOutcome(error, request);
  }

  if (!canUseAi) {
    return (
      <main className="app-outcome app-outcome-unauthorised">
        <section>
          <p className="eyebrow">unauthorised</p>
          <h1>Access denied</h1>
          <p>You do not have permission to draft content with AI.</p>
        </section>
      </main>
    );
  }

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "New AI draft" }]} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Content Studio</p>
        <h2>Draft content with AI</h2>
        <p>
          Describe what you want to publish. You will review the draft first; accepting it creates a new <strong>draft</strong>
          content item that goes through the normal approval steps. Nothing is published automatically.
        </p>
        <ContentDraftForm action={generateContentDraftAction.bind(null, request, null)} revising={false} defaultType="article" />
      </section>
    </AppShell>
  );
}

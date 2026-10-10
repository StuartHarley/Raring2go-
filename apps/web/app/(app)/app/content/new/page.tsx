import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { hasContentAiCapability } from "../../../../../lib/publishing-runtime";
import { PageHeader, Panel } from "../../../../../lib/page-ui";
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
    return protectedOutcome(new ShellAccessError("unauthorised", "You do not have permission to draft content with AI."), request);
  }

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "New AI draft" }]} />
      <PageHeader
        eyebrow="Content Studio"
        title="Draft content with AI"
        intro="Describe what you want to publish. You review the draft first; accepting it creates a new draft content item that goes through the normal approval steps. Nothing is published automatically."
      />
      <Panel>
        <ContentDraftForm action={generateContentDraftAction.bind(null, request, null)} revising={false} defaultType="article" />
      </Panel>
    </AppShell>
  );
}

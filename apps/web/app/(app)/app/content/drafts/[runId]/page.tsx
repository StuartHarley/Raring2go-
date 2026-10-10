import type { Route } from "next";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readContentDraftRun } from "../../../../../../lib/publishing-runtime";
import { formatLabel } from "../../../../../../lib/format";
import { Actions, FactList, Notice, PageHeader, Panel, StatusBadge } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { acceptContentDraftAction, rejectContentDraftAction } from "../../actions";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "AI draft" };

type PageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const resultMessages: Record<string, string> = {
  not_allowed: "You do not have permission to create or change this content.",
  wrong_state: "This draft can no longer be accepted: it was already decided, or the content it revises is no longer a draft."
};

export default async function ContentDraftReviewPage({ params, searchParams }: PageProps) {
  const { runId } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const errorMessage = resultParam ? resultMessages[resultParam] : undefined;
  const result = await load(request, runId);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { run } = result;
  const output = run.output as { title?: string; standfirst?: string; body?: string; notes?: string };
  const revising = run.subjectType === "content_item";
  const pending = run.approvalState === "pending" && run.status === "succeeded";

  return (
    <>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "Review AI draft" }]} />

      <PageHeader
        eyebrow={revising ? "AI revision" : "AI draft"}
        title={output.title ?? "Draft"}
        intro={output.standfirst ? <em>{output.standfirst}</em> : "Read the draft, then accept it as draft content for the normal approval steps or reject it."}
      >
        <StatusBadge status={run.approvalState} />
      </PageHeader>

      <Panel eyebrow="Draft" title="What the AI wrote">
        <div className="draft-body">
          {(output.body ?? "").split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        {output.notes ? (
          <Notice tone="warning">
            <strong>Check before using:</strong> {output.notes}
          </Notice>
        ) : null}
        <FactList
          items={[
            { label: "Brief", value: String(run.input.brief ?? "") || "Not given" },
            { label: "Provider", value: formatLabel(run.providerKey) },
            { label: "Model", value: run.modelReference }
          ]}
        />
      </Panel>

      <Panel eyebrow="Decision" title={pending ? "Accept or reject" : "Decided"}>
        {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}
        {pending ? (
          <Actions>
            <form action={acceptContentDraftAction.bind(null, request, run.id)}>
              <button type="submit" className="r2-button r2-button--primary">
                {revising ? "Accept as a new draft version" : "Accept and create draft content"}
              </button>
            </form>
            <form action={rejectContentDraftAction.bind(null, request, run.id)}>
              <button type="submit" className="r2-button r2-button--secondary">
                Reject
              </button>
            </form>
          </Actions>
        ) : (
          <Notice tone="success">
            This draft is {formatLabel(run.approvalState).toLowerCase()}{run.appliedAt ? " and has been applied" : ""}.
          </Notice>
        )}
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, runId: string) {
  try {
    const shell = await requireShellPermission(request, { module: "content", action: "view" });
    const run = await readContentDraftRun({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, runId);
    return { run };
  } catch (error) {
    return { error };
  }
}

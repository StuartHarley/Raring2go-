import type { Route } from "next";
import { AiRunAccessError } from "@raring2go/ai";
import { requireShellPermission } from "../../../../../../lib/app-shell";
import { readContentDraftRun } from "../../../../../../lib/publishing-runtime";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
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
    return protectedOutcome(result.error, request);
  }

  const { run } = result;
  const output = run.output as { title?: string; standfirst?: string; body?: string; notes?: string };
  const revising = run.subjectType === "content_item";
  const pending = run.approvalState === "pending" && run.status === "succeeded";

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "Content Studio", href: "/app/content" as Route }, { label: "Review AI draft" }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">{revising ? "AI revision" : "AI draft"} · {run.approvalState.replace("_", " ")}</p>
        <h2>{output.title ?? "Draft"}</h2>
        {output.standfirst ? <p><em>{output.standfirst}</em></p> : null}
        <div className="draft-body">
          {(output.body ?? "").split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        {output.notes ? (
          <p className="notice notice--error" role="note">
            <strong>Check before using:</strong> {output.notes}
          </p>
        ) : null}
        <p className="journey-builder-step-note">
          Brief: {String(run.input.brief ?? "")} · {run.providerKey} / {run.modelReference}
        </p>

        {errorMessage ? <p role="alert" className="notice notice--error">{errorMessage}</p> : null}

        {pending ? (
          <div className="franchise-actions">
            <form action={acceptContentDraftAction.bind(null, request, run.id)}>
              <button type="submit">{revising ? "Accept as a new draft version" : "Accept and create draft content"}</button>
            </form>
            <form action={rejectContentDraftAction.bind(null, request, run.id)}>
              <button type="submit">Reject</button>
            </form>
          </div>
        ) : (
          <p role="status" className="notice notice--success">
            This draft is {run.approvalState.replace("_", " ")}{run.appliedAt ? " and has been applied" : ""}.
          </p>
        )}
      </section>
    </AppShell>
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

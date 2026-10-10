import type { Route } from "next";
import { AiRunAccessError } from "@raring2go/ai";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { hasAiRunCapability, readAiRun } from "../../../../../../lib/ai-runtime";
import { getDirectory } from "../../../../../../lib/directory";
import { displayName, formatCode, formatDateTime, formatLabel } from "../../../../../../lib/format";
import { Actions, FactList, Metrics, Notice, PageHeader, Panel } from "../../../../../../lib/page-ui";
import { Breadcrumbs } from "../../../../../../lib/workflow-ui";
import { requestFromSearchParamsAndCookies } from "../../../page";
import { decideAiRunAction } from "../actions";
import { getPermissionData } from "../../../../../../lib/permission-source";
import { protectedOutcome } from "../../../../../../lib/protected-outcome";

export const metadata = { title: "AI run" };

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  approved: { tone: "success", text: "Approved. The output may now be used." },
  rejected: { tone: "success", text: "Rejected. The output will not be used." },
  not_allowed: { tone: "error", text: "You do not have permission to decide this." },
  wrong_state: { tone: "error", text: "This can no longer be decided: it was already decided, or high-risk output needs a different approver than the requester." }
};

const decisionLabel: Record<string, string> = { pending: "Awaiting decision", approved: "Approved", rejected: "Rejected", not_required: "No decision needed" };

/** "content.draft_article" → "Content draft article": dotted task codes read as words. */

export default async function AiRunPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await load(request, id);

  if ("error" in result) {
    // A AiRunAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof AiRunAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error);
  }

  const { run, canDecide } = result;
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);
  const directory = getDirectory();
  const [requesterName, deciderName] = await Promise.all([
    run.actorUserId ? directory.userName(run.actorUserId) : undefined,
    run.decidedByUserId ? directory.userName(run.decidedByUserId) : undefined
  ]);
  const decision = decisionLabel[run.approvalState] ?? formatLabel(run.approvalState);

  return (
    <>
      <Breadcrumbs items={[{ label: "AI runs", href: "/app/system/ai" as Route }, { label: run.purpose }]} />

      <PageHeader eyebrow="AI run" title={run.purpose} intro={`${formatCode(run.taskKey)}, requested ${formatDateTime(run.createdAt)}.`} />

      <Panel>
        <Metrics
          items={[
            { label: "Result", value: run.status === "failed" ? "Failed" : "Completed", tone: run.status === "failed" ? "danger" : "success" },
            { label: "Decision", value: decision, tone: run.approvalState === "pending" ? "warning" : run.approvalState === "rejected" ? "danger" : run.approvalState === "approved" ? "success" : "neutral" },
            { label: "Risk", value: formatLabel(run.risk), tone: run.risk === "high" ? "warning" : "neutral" },
            { label: "Tokens in / out", value: `${run.inputTokens} / ${run.outputTokens}` }
          ]}
        />
        {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}
        {run.error ? <Notice tone="error">{run.error}</Notice> : null}
        <FactList
          items={[
            { label: "Task", value: `${formatCode(run.taskKey)} (prompt ${run.promptVersion})` },
            { label: "Model", value: `${formatLabel(run.providerKey)} / ${run.modelReference}` },
            { label: "Requested by", value: run.actorType === "automation" ? "Automation" : displayName(requesterName, "A person") },
            { label: "Created", value: `${formatDateTime(run.createdAt)}${run.latencyMs != null ? ` (${run.latencyMs}ms)` : ""}` },
            ...(run.subjectType
              ? [
                  {
                    label: "For record",
                    value: (
                      <>
                        {formatLabel(run.subjectType)} <code>{run.subjectId}</code>
                      </>
                    )
                  }
                ]
              : []),
            ...(run.decidedAt
              ? [{ label: "Decided", value: `${formatDateTime(run.decidedAt)} by ${displayName(deciderName, "a person")}${run.decisionNote ? ` — ${run.decisionNote}` : ""}` }]
              : []),
            ...(run.appliedAt ? [{ label: "Applied", value: formatDateTime(run.appliedAt) }] : [])
          ]}
        />

        {run.approvalState === "pending" && canDecide ? (
          <form className="franchise-form">
            <label>
              Note (optional)
              <input name="note" maxLength={500} />
            </label>
            <Actions>
              <button type="submit" className="r2-button r2-button--primary" formAction={decideAiRunAction.bind(null, request, run.id, "approved")}>
                Approve
              </button>
              <button type="submit" className="r2-button r2-button--danger" formAction={decideAiRunAction.bind(null, request, run.id, "rejected")}>
                Reject
              </button>
            </Actions>
          </form>
        ) : null}
      </Panel>

      <Panel eyebrow="What it was given" title="Sources and input" intro="References to the records used (never copies), and a bounded summary of the request.">
        <pre className="code-block">{pretty({ sources: run.sourceRefs, input: run.input })}</pre>
      </Panel>

      <Panel eyebrow="What it returned" title="Output">
        <pre className="code-block">{pretty(run.output)}</pre>
      </Panel>
    </>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>, id: string) {
  try {
    const shell = await requireShellPermission(request, { module: "ai.run", action: "view" });
    const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const run = await readAiRun(context, id);
    return { run, canDecide: hasAiRunCapability(await getPermissionData(), context, "decide") };
  } catch (error) {
    return { error };
  }
}

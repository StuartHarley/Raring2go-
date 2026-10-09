import type { Route } from "next";
import { AiRunAccessError } from "@raring2go/ai";
import { ShellAccessError, requireShellPermission } from "../../../../../../lib/app-shell";
import { hasAiRunCapability, readAiRun } from "../../../../../../lib/ai-runtime";
import { Breadcrumbs, StatusBadge } from "../../../../../../lib/workflow-ui";
import { AppShell } from "../../../../layout";
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

export default async function AiRunPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const result = await load(request, id);

  if ("error" in result) {
    // A AiRunAccessError means the record exists but is outside this actor's scope: shown as a denial, not a crash.
    return protectedOutcome(result.error instanceof AiRunAccessError ? new ShellAccessError("unauthorised", result.error.message) : result.error, request);
  }

  const { run, canDecide } = result;
  const resultParam = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = resultParam ? resultMessages[resultParam] : undefined;
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);

  return (
    <AppShell request={request}>
      <Breadcrumbs items={[{ label: "AI runs", href: "/app/system/ai" as Route }, { label: run.purpose }]} />

      <section className="app-panel franchise-panel">
        <p className="eyebrow">AI run</p>
        <h2>{run.purpose}</h2>
        <div className="franchise-metrics">
          <article>
            <span>Result</span>
            <strong>
              <StatusBadge status={run.status === "failed" ? "failed" : "completed"} />
            </strong>
          </article>
          <article>
            <span>Decision</span>
            <strong>{run.approvalState.replace("_", " ")}</strong>
          </article>
          <article>
            <span>Risk</span>
            <strong>{run.risk}</strong>
          </article>
          <article>
            <span>Tokens in / out</span>
            <strong>{run.inputTokens} / {run.outputTokens}</strong>
          </article>
        </div>
        {banner ? (
          <p role={banner.tone === "error" ? "alert" : "status"} className={`notice notice--${banner.tone}`}>
            {banner.text}
          </p>
        ) : null}
        {run.error ? <p role="alert" className="notice notice--error">{run.error}</p> : null}
        <dl>
          <dt>Task</dt>
          <dd>{run.taskKey} ({run.promptVersion})</dd>
          <dt>Model</dt>
          <dd>{run.providerKey} / {run.modelReference}</dd>
          <dt>Requested by</dt>
          <dd>{run.actorType === "automation" ? "Automation" : run.actorUserId ?? "-"}</dd>
          <dt>Created</dt>
          <dd>{run.createdAt.toLocaleString("en-GB")}{run.latencyMs != null ? ` (${run.latencyMs}ms)` : ""}</dd>
          {run.subjectType ? (
            <>
              <dt>For record</dt>
              <dd>{run.subjectType}: {run.subjectId}</dd>
            </>
          ) : null}
          {run.decidedAt ? (
            <>
              <dt>Decided</dt>
              <dd>{run.decidedAt.toLocaleString("en-GB")} by {run.decidedByUserId}{run.decisionNote ? ` — ${run.decisionNote}` : ""}</dd>
            </>
          ) : null}
          {run.appliedAt ? (
            <>
              <dt>Applied</dt>
              <dd>{run.appliedAt.toLocaleString("en-GB")}</dd>
            </>
          ) : null}
        </dl>

        {run.approvalState === "pending" && canDecide ? (
          <form className="franchise-form">
            <label>
              Note (optional)
              <input name="note" maxLength={500} />
            </label>
            <div className="franchise-actions">
              <button type="submit" formAction={decideAiRunAction.bind(null, request, run.id, "approved")}>Approve</button>
              <button type="submit" formAction={decideAiRunAction.bind(null, request, run.id, "rejected")}>Reject</button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="app-panel franchise-panel" aria-label="Sources">
        <p className="eyebrow">What it was given</p>
        <h2>Sources and input</h2>
        <p>References to the records used (never copies), and a bounded summary of the request.</p>
        <pre className="code-block">{pretty({ sources: run.sourceRefs, input: run.input })}</pre>
      </section>

      <section className="app-panel franchise-panel" aria-label="Output">
        <p className="eyebrow">What it returned</p>
        <h2>Output</h2>
        <pre className="code-block">{pretty(run.output)}</pre>
      </section>
    </AppShell>
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

import type { FranchisePanel } from "../../../../../lib/assistants-franchise";
import { attentionItems, healthInsight, onboardingGuidance } from "@raring2go/assistants";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { formatLabel, formatLabels } from "../../../../../lib/format";
import { Actions, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { briefingAction, compareAgreementsAction, decideComparisonAction } from "./assistant-actions";

const severityLabels = { high: "Urgent", medium: "Soon", low: "Later" } as const;
const approvalLabels = { pending: "awaiting review by someone else", approved: "reviewed", rejected: "rejected" } as const;

/**
 * The franchise assistant. Next steps, attention items and the health insight are calculated from the franchise's
 * own records (no model), and show to anyone who can see the franchise. AI only adds the short introduction, and the
 * agreement comparison is a Head Office legal-review aid that needs a second person before it is relied on.
 */
export function FranchiseAssistantPanel({ request, franchiseId, panel, resultCode }: { request: RequestedShellContext; franchiseId: string; panel: FranchisePanel; resultCode?: string }) {
  const now = new Date(`${panel.today}T00:00:00Z`);
  const steps = onboardingGuidance(panel.facts, now);
  const attention = attentionItems(panel.facts, now);
  const health = panel.facts.health ? healthInsight(panel.facts.health) : null;
  const { briefing, comparison } = panel;

  return (
    <Panel id="franchise-assistant" eyebrow="Franchise assistant" title={`Where ${panel.facts.franchiseName} stands`} className="franchise-panel">
      <AssistantBanner code={resultCode} />

      {briefing ? (
        <div>
          <p>{briefing.output.summary}</p>
          <p className="muted">{briefing.output.supportNote}</p>
          <AiPreparedNote run={{ id: briefing.runId, createdAt: briefing.createdAt, providerKey: "", approvalState: "not_required" }} />
        </div>
      ) : null}

      <RecordList>
        <RecordCard title="Next steps">
          {steps.length === 0 ? (
            <span>Nothing is outstanding on the way to launch.</span>
          ) : (
            <ol>
              {steps.map((step) => (
                <li key={step.title}>
                  {step.title}
                  <span className="muted"> — {step.reason}</span>
                </li>
              ))}
            </ol>
          )}
        </RecordCard>
        <RecordCard title="Needs attention">
          {attention.length === 0 ? (
            <span>Nothing needs attention.</span>
          ) : (
            <ul>
              {attention.map((item) => (
                <li key={item.message}>
                  <span className="muted">{severityLabels[item.severity]} · {formatLabel(item.area)}:</span> {item.message}
                </li>
              ))}
            </ul>
          )}
        </RecordCard>
        {health ? (
          <RecordCard title="Health" lines={[health.summary]}>
            {health.weaknesses.length > 0 ? (
              <ul>
                {health.weaknesses.map((weakness) => (
                  <li key={weakness.label}>
                    {weakness.label} ({weakness.score}/100): {weakness.advice}
                  </li>
                ))}
              </ul>
            ) : null}
            {health.strengths.length > 0 ? <span className="muted">Strong: {health.strengths.map((s) => `${s.label} (${s.score})`).join(", ")}.</span> : null}
          </RecordCard>
        ) : null}
      </RecordList>
      <p className="muted">Calculated from this franchise&apos;s records. Nothing here is an AI opinion.</p>

      {panel.canAssist ? (
        panel.aiConfigured ? (
          <form action={briefingAction.bind(null, request, franchiseId)}>
            <button type="submit" className="r2-button r2-button--secondary">{briefing ? "Refresh the AI introduction" : "Add an AI introduction"}</button>
          </form>
        ) : (
          <p className="muted">The AI introduction is not switched on for this environment. The analysis above does not need it.</p>
        )
      ) : null}

      {panel.canCompare && panel.aiConfigured ? (
        <div id="agreement-comparison">
          <h3>Compare two agreement versions</h3>
          <p className="muted">A reviewer&apos;s aid: it lists what wording changed. It is not legal advice, and a different person from you must review it before it is relied on.</p>
          <form action={compareAgreementsAction.bind(null, request, franchiseId)} className="franchise-form">
            <label>
              Earlier version
              <select name="from" required>
                {panel.agreementVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Later version
              <select name="to" required>
                {panel.agreementVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.label}
                  </option>
                ))}
              </select>
            </label>
            <Actions>
              <button type="submit" className="r2-button r2-button--primary">Compare</button>
            </Actions>
          </form>

          {comparison ? (
            <RecordList>
              <RecordCard
                title={
                  <>
                    {comparison.output.summary} <span className="muted">({approvalLabels[comparison.approvalState as keyof typeof approvalLabels] ?? formatLabel(comparison.approvalState)})</span>
                  </>
                }
                status={comparison.approvalState}
                lines={[comparison.output.notice]}
              >
                <AiPreparedNote run={{ id: comparison.runId, createdAt: comparison.createdAt, providerKey: "", approvalState: comparison.approvalState as "pending" }} />
              </RecordCard>
              {comparison.output.mergeFields.added.length + comparison.output.mergeFields.removed.length > 0 ? (
                <RecordCard
                  title="Merge fields"
                  lines={[
                    `Added: ${comparison.output.mergeFields.added.length > 0 ? formatLabels(comparison.output.mergeFields.added) : "none"}. Removed: ${comparison.output.mergeFields.removed.length > 0 ? formatLabels(comparison.output.mergeFields.removed) : "none"}.`
                  ]}
                />
              ) : null}
              {comparison.output.changes.map((change) => (
                <RecordCard
                  key={change.path}
                  title={
                    <>
                      {formatLabel(change.kind)} <code>{change.path}</code>
                    </>
                  }
                  lines={[change.before ? `Before: ${change.before}` : null, change.after ? `After: ${change.after}` : null, <span key="why" className="muted">{change.whyItMatters}</span>]}
                />
              ))}
              {comparison.approvalState === "pending" ? (
                <Actions>
                  <form action={decideComparisonAction.bind(null, request, franchiseId, comparison.runId, "approved")}>
                    <button type="submit" className="r2-button r2-button--primary">Mark as reviewed</button>
                  </form>
                  <form action={decideComparisonAction.bind(null, request, franchiseId, comparison.runId, "rejected")}>
                    <button type="submit" className="r2-button r2-button--danger">Reject</button>
                  </form>
                </Actions>
              ) : null}
              <p className="muted">The person who asked for this comparison cannot approve it; if they try, it is refused.</p>
            </RecordList>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

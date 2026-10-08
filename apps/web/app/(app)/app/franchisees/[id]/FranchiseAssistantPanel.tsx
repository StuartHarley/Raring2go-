import type { FranchisePanel } from "../../../../../lib/assistants-franchise";
import { attentionItems, healthInsight, onboardingGuidance } from "@raring2go/assistants";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { briefingAction, compareAgreementsAction, decideComparisonAction } from "./assistant-actions";

const severityLabels = { high: "Urgent", medium: "Soon", low: "Later" } as const;

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
    <section id="franchise-assistant" className="app-panel franchise-panel" aria-label="Franchise assistant">
      <p className="eyebrow">Franchise assistant</p>
      <h2>Where {panel.facts.franchiseName} stands</h2>
      <AssistantBanner code={resultCode} />

      {briefing ? (
        <div>
          <p>{briefing.output.summary}</p>
          <p className="muted">{briefing.output.supportNote}</p>
          <AiPreparedNote run={{ id: briefing.runId, createdAt: briefing.createdAt, providerKey: "", approvalState: "not_required" }} />
        </div>
      ) : null}

      <div className="franchise-list" aria-label="Calculated analysis">
        <div>
          <strong>Next steps</strong>
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
        </div>
        <div>
          <strong>Needs attention</strong>
          {attention.length === 0 ? (
            <span>Nothing needs attention.</span>
          ) : (
            <ul>
              {attention.map((item) => (
                <li key={item.message}>
                  <span className="muted">{severityLabels[item.severity]} · {item.area}:</span> {item.message}
                </li>
              ))}
            </ul>
          )}
        </div>
        {health ? (
          <div>
            <strong>Health</strong>
            <span>{health.summary}</span>
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
          </div>
        ) : null}
        <p className="muted">Calculated from this franchise&apos;s records. Nothing here is an AI opinion.</p>
      </div>

      {panel.canAssist ? (
        panel.aiConfigured ? (
          <form action={briefingAction.bind(null, request, franchiseId)}>
            <button type="submit">{briefing ? "Refresh the AI introduction" : "Add an AI introduction"}</button>
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
            <div className="franchise-actions">
              <button type="submit">Compare</button>
            </div>
          </form>

          {comparison ? (
            <div className="franchise-list" aria-label="Agreement comparison">
              <div>
                <strong>
                  {comparison.output.summary} <span className="muted">({comparison.approvalState === "pending" ? "awaiting review by someone else" : comparison.approvalState === "approved" ? "reviewed" : "rejected"})</span>
                </strong>
                <span className="muted">{comparison.output.notice}</span>
                <AiPreparedNote run={{ id: comparison.runId, createdAt: comparison.createdAt, providerKey: "", approvalState: comparison.approvalState as "pending" }} />
              </div>
              {comparison.output.mergeFields.added.length + comparison.output.mergeFields.removed.length > 0 ? (
                <div>
                  <strong>Merge fields</strong>
                  <span>
                    Added: {comparison.output.mergeFields.added.join(", ") || "none"}. Removed: {comparison.output.mergeFields.removed.join(", ") || "none"}.
                  </span>
                </div>
              ) : null}
              {comparison.output.changes.map((change) => (
                <div key={change.path}>
                  <strong>
                    {change.kind} <code>{change.path}</code>
                  </strong>
                  {change.before ? <span>Before: {change.before}</span> : null}
                  {change.after ? <span>After: {change.after}</span> : null}
                  <span className="muted">{change.whyItMatters}</span>
                </div>
              ))}
              {comparison.approvalState === "pending" ? (
                <div className="franchise-actions">
                  <form action={decideComparisonAction.bind(null, request, franchiseId, comparison.runId, "approved")}>
                    <button type="submit">Mark as reviewed</button>
                  </form>
                  <form action={decideComparisonAction.bind(null, request, franchiseId, comparison.runId, "rejected")}>
                    <button type="submit">Reject</button>
                  </form>
                </div>
              ) : null}
              <p className="muted">The person who asked for this comparison cannot approve it; if they try, it is refused.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

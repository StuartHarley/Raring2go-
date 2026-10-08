import type { SalesPanel } from "../../../../../lib/assistants-sales";
import { assessRenewalRisk, nextBestActions, packageIdeas } from "@raring2go/assistants";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { decideDraftAction, draftOutreachAction, generateBriefAction } from "./assistant-actions";

const riskLabels = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;
const purposeLabels = { intro: "Introduction", follow_up: "Follow-up", renewal: "Renewal", objection_reply: "Reply to an objection", thank_you: "Thank you" } as const;

/**
 * The sales assistant. The analysis above the line is calculated from the advertiser's record by rules anyone
 * can read, and works with no model. The AI sections below only word and expand it, and are labelled as drafts.
 */
export function SalesAssistantPanel({ request, advertiserId, panel, canAssist, senderName, resultCode }: { request: RequestedShellContext; advertiserId: string; panel: SalesPanel; canAssist: boolean; senderName: string; resultCode?: string }) {
  const now = new Date(`${panel.today}T00:00:00Z`);
  const risk = assessRenewalRisk(panel.facts, now);
  const actions = nextBestActions(panel.facts, now);
  const ideas = packageIdeas(panel.facts, panel.catalogue);
  const { brief, draft } = panel;

  return (
    <section id="sales-assistant" className="app-panel franchise-panel" aria-label="Sales assistant">
      <p className="eyebrow">Sales assistant</p>
      <h2>What to do next with {panel.facts.advertiserName}</h2>
      <AssistantBanner code={resultCode} />

      <div className="franchise-list" aria-label="Calculated analysis">
        <div>
          <strong>
            Renewal: {riskLabels[risk.level]} <span className="muted">({risk.score}/100)</span>
          </strong>
          <ul>
            {risk.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
        <div>
          <strong>Next best actions</strong>
          <ol>
            {actions.map((action) => (
              <li key={action.action}>
                {action.action}
                <span className="muted"> — {action.reason}</span>
              </li>
            ))}
          </ol>
        </div>
        {ideas.length > 0 ? (
          <div>
            <strong>Package ideas</strong>
            <ul>
              {ideas.map((idea) => (
                <li key={idea.key}>
                  {idea.name}
                  <span className="muted"> — {idea.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="muted">Calculated from this advertiser&apos;s record. The score and the actions are rules, not an AI opinion.</p>
      </div>

      {canAssist ? (
        panel.aiConfigured ? (
          <>
            {brief ? (
              <div className="franchise-list" aria-label="AI brief">
                <div>
                  <strong>AI brief</strong>
                  <span>{brief.output.summary}</span>
                  <span>
                    {brief.output.nextBestAction.action} <span className="muted">— {brief.output.nextBestAction.why}</span>
                  </span>
                  <span className="muted">{brief.output.renewalRisk.explanation}</span>
                </div>
                <div>
                  <strong>Likely objections</strong>
                  <ul>
                    {brief.output.objections.map((entry) => (
                      <li key={entry.objection}>
                        <em>{entry.objection}</em> {entry.response}
                      </li>
                    ))}
                  </ul>
                </div>
                <AiPreparedNote run={{ id: brief.runId, createdAt: brief.createdAt, providerKey: "", approvalState: "not_required" }} />
              </div>
            ) : null}
            <form action={generateBriefAction.bind(null, request, advertiserId)}>
              <button type="submit">{brief ? "Refresh AI brief" : "Add an AI brief"}</button>
            </form>

            <form action={draftOutreachAction.bind(null, request, advertiserId)} className="franchise-form">
              <h3>Draft an email</h3>
              <p className="muted">A draft to edit and send yourself. Nothing is sent from here, and any price in it must already be in this advertiser&apos;s record.</p>
              <label>
                Purpose
                <select name="purpose" defaultValue="follow_up">
                  {Object.entries(purposeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Your name
                <input name="senderName" type="text" maxLength={80} defaultValue={senderName} />
              </label>
              <label>
                What you want to say (optional)
                <textarea name="talkingPoints" rows={3} maxLength={1200} />
              </label>
              <div className="franchise-actions">
                <button type="submit">Draft email</button>
              </div>
            </form>

            {draft ? (
              <div className="franchise-list" aria-label="Email draft">
                <div>
                  <strong>
                    Email draft <span className="muted">({draft.approvalState === "pending" ? "awaiting your review" : draft.approvalState === "approved" ? "reviewed" : "discarded"})</span>
                  </strong>
                  <span>
                    <strong>Subject:</strong> {draft.output.subject}
                  </span>
                  <pre className="code-block">{draft.output.body}</pre>
                  {draft.output.notes ? <span className="muted">Check before sending: {draft.output.notes}</span> : null}
                  <AiPreparedNote run={{ id: draft.runId, createdAt: draft.createdAt, providerKey: "", approvalState: draft.approvalState as "pending" }} />
                </div>
                {draft.approvalState === "pending" ? (
                  <div className="franchise-actions">
                    <form action={decideDraftAction.bind(null, request, advertiserId, draft.runId, "approved")}>
                      <button type="submit">Mark as reviewed</button>
                    </form>
                    <form action={decideDraftAction.bind(null, request, advertiserId, draft.runId, "rejected")}>
                      <button type="submit">Discard</button>
                    </form>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">AI briefs and email drafts are not switched on for this environment. The analysis above does not need them.</p>
        )
      ) : null}
    </section>
  );
}

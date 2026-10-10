import type { SalesPanel } from "../../../../../lib/assistants-sales";
import { assessRenewalRisk, nextBestActions, packageIdeas } from "@raring2go/assistants";
import { AiPreparedNote, AssistantBanner } from "../../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { Actions, Panel, RecordCard, RecordList, type Tone } from "../../../../../lib/page-ui";
import { decideDraftAction, draftOutreachAction, generateBriefAction } from "./assistant-actions";

const riskLabels = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;
const riskTones: Record<keyof typeof riskLabels, Tone> = { low: "success", medium: "warning", high: "danger" };
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
    <Panel
      id="sales-assistant"
      eyebrow="Sales assistant"
      title={`What to do next with ${panel.facts.advertiserName}`}
      intro="Calculated from this advertiser's record. The score and the actions are rules, not an AI opinion."
    >
      <AssistantBanner code={resultCode} />

      <RecordList>
        <RecordCard title={`Renewal: ${riskLabels[risk.level]}`} status={`${risk.score} out of 100`} tone={riskTones[risk.level]}>
          <ul>
            {risk.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </RecordCard>
        <RecordCard title="Next best actions">
          <ol>
            {actions.map((action) => (
              <li key={action.action}>
                {action.action}
                <span className="muted"> — {action.reason}</span>
              </li>
            ))}
          </ol>
        </RecordCard>
        {ideas.length > 0 ? (
          <RecordCard title="Package ideas">
            <ul>
              {ideas.map((idea) => (
                <li key={idea.key}>
                  {idea.name}
                  <span className="muted"> — {idea.reason}</span>
                </li>
              ))}
            </ul>
          </RecordCard>
        ) : null}
      </RecordList>

      {canAssist ? (
        panel.aiConfigured ? (
          <>
            {brief ? (
              <RecordList>
                <RecordCard
                  title="AI brief"
                  lines={[
                    brief.output.summary,
                    <>
                      {brief.output.nextBestAction.action} <span className="muted">— {brief.output.nextBestAction.why}</span>
                    </>,
                    brief.output.renewalRisk.explanation
                  ]}
                >
                  <AiPreparedNote run={{ id: brief.runId, createdAt: brief.createdAt, providerKey: "", approvalState: "not_required" }} />
                </RecordCard>
                <RecordCard title="Likely objections">
                  <ul>
                    {brief.output.objections.map((entry) => (
                      <li key={entry.objection}>
                        <em>{entry.objection}</em> {entry.response}
                      </li>
                    ))}
                  </ul>
                </RecordCard>
              </RecordList>
            ) : null}
            <form action={generateBriefAction.bind(null, request, advertiserId)}>
              <button type="submit" className="r2-button r2-button--secondary">{brief ? "Refresh AI brief" : "Add an AI brief"}</button>
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
              <Actions>
                <button type="submit" className="r2-button r2-button--primary">Draft email</button>
              </Actions>
            </form>

            {draft ? (
              <RecordList>
                <RecordCard
                  title="Email draft"
                  status={draft.approvalState === "pending" ? "awaiting your review" : draft.approvalState === "approved" ? "reviewed" : "discarded"}
                  tone={draft.approvalState === "pending" ? "warning" : draft.approvalState === "approved" ? "success" : "neutral"}
                  lines={[
                    <>
                      <strong>Subject:</strong> {draft.output.subject}
                    </>
                  ]}
                >
                  <pre className="code-block">{draft.output.body}</pre>
                  {draft.output.notes ? <p className="muted">Check before sending: {draft.output.notes}</p> : null}
                  <AiPreparedNote run={{ id: draft.runId, createdAt: draft.createdAt, providerKey: "", approvalState: draft.approvalState as "pending" }} />
                  {draft.approvalState === "pending" ? (
                    <Actions>
                      <form action={decideDraftAction.bind(null, request, advertiserId, draft.runId, "approved")}>
                        <button type="submit" className="r2-button r2-button--secondary">Mark as reviewed</button>
                      </form>
                      <form action={decideDraftAction.bind(null, request, advertiserId, draft.runId, "rejected")}>
                        <button type="submit" className="r2-button r2-button--danger">Discard</button>
                      </form>
                    </Actions>
                  ) : null}
                </RecordCard>
              </RecordList>
            ) : null}
          </>
        ) : (
          <p className="muted">AI briefs and email drafts are not switched on for this environment. The analysis above does not need them.</p>
        )
      ) : null}
    </Panel>
  );
}

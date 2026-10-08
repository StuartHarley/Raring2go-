import Link from "next/link";
import type { Route } from "next";
import type { RoyaltyPanel } from "../../../../lib/assistants-finance";
import { AiPreparedNote, AssistantBanner } from "../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { royaltyNotesAction } from "./assistant-actions";

const kindLabels = { swing: "Large change", zero_after_positive: "Zero after positive", heavy_adjustments: "Heavy adjustments", duplicate_period: "Duplicate period", missing_period: "Possible missing period" } as const;

export function RoyaltyReviewPanel({ request, panel, resultCode, sessionQuery }: { request: RequestedShellContext; panel: RoyaltyPanel; resultCode?: string; sessionQuery: string }) {
  const { flags, notes } = panel;
  return (
    <section id="royalty-review" className="app-panel franchise-panel" aria-label="Royalty review">
      <p className="eyebrow">Finance assistant</p>
      <h2>Royalty statements that look unusual</h2>
      <p>
        Each statement is compared with that territory&apos;s own history. A flag is a question to ask, not a finding: nothing here changes a statement, an adjustment or a payment.
      </p>
      <AssistantBanner code={resultCode} />
      {flags.length === 0 ? (
        <p>No statements look unusual compared with their territory&apos;s history. (At least three earlier statements are needed before a change can be judged.)</p>
      ) : (
        <div className="franchise-list">
          {flags.map((flag) => {
            const question = notes?.output.questions.find((entry) => entry.key === flag.key)?.question;
            return (
              <div key={flag.key}>
                <strong>
                  {flag.territoryName}: {kindLabels[flag.kind]} <span className="muted">({flag.severity})</span>
                </strong>
                <span>{flag.detail}</span>
                {question ? <span className="muted">Question to ask: {question}</span> : null}
              </div>
            );
          })}
        </div>
      )}
      {notes ? (
        <>
          <p>{notes.output.summary}</p>
          <AiPreparedNote run={{ id: notes.runId, createdAt: notes.createdAt, providerKey: "", approvalState: notes.approvalState as "pending" }} />
          <p className="muted">
            {notes.output.notice} {notes.approvalState === "pending" ? "Because this concerns money, a different person must review it before it is relied on:" : ""}{" "}
            <Link href={`/app/system/ai/${notes.runId}${sessionQuery}` as Route}>Open the AI run</Link>
          </p>
        </>
      ) : null}
      {panel.canAssist && flags.length > 0 ? (
        panel.aiConfigured ? (
          <form action={royaltyNotesAction.bind(null, request)}>
            <button type="submit">{notes ? "Refresh the questions" : "Suggest questions to ask"}</button>
          </form>
        ) : (
          <p className="muted">AI question suggestions are not switched on for this environment. The flags above do not need them.</p>
        )
      ) : null}
    </section>
  );
}

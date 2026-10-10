import Link from "next/link";
import type { Route } from "next";
import type { RoyaltyPanel } from "../../../../lib/assistants-finance";
import { AiPreparedNote, AssistantBanner } from "../../../../lib/assistant-ui";
import type { RequestedShellContext } from "../../../../lib/app-shell";
import { EmptyState, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import type { Tone } from "../../../../lib/page-ui";
import { royaltyNotesAction } from "./assistant-actions";

const kindLabels = { swing: "Large change", zero_after_positive: "Zero after positive", heavy_adjustments: "Heavy adjustments", duplicate_period: "Duplicate period", missing_period: "Possible missing period" } as const;

const severityTone: Record<string, Tone> = { high: "danger", medium: "warning", low: "info" };

export function RoyaltyReviewPanel({ request, panel, resultCode, sessionQuery }: { request: RequestedShellContext; panel: RoyaltyPanel; resultCode?: string; sessionQuery: string }) {
  const { flags, notes } = panel;
  return (
    <Panel
      id="royalty-review"
      eyebrow="Finance assistant"
      title="Statements that look unusual"
      intro="Each statement is compared with that territory's own history. A flag is a question to ask, not a finding: nothing here changes a statement, an adjustment or a payment."
    >
      <AssistantBanner code={resultCode} />
      {flags.length === 0 ? (
        <EmptyState title="Nothing looks unusual">
          Every statement is in line with its territory&apos;s history. At least three earlier statements are needed before a change can be judged.
        </EmptyState>
      ) : (
        <RecordList>
          {flags.map((flag) => {
            const question = notes?.output.questions.find((entry) => entry.key === flag.key)?.question;
            return (
              <RecordCard
                key={flag.key}
                title={`${flag.territoryName}: ${kindLabels[flag.kind]}`}
                status={flag.severity}
                tone={severityTone[flag.severity] ?? "neutral"}
                lines={[flag.detail, question ? `Question to ask: ${question}` : null]}
              />
            );
          })}
        </RecordList>
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
            <button type="submit" className="r2-button r2-button--secondary">{notes ? "Refresh the questions" : "Suggest questions to ask"}</button>
          </form>
        ) : (
          <p className="muted">AI question suggestions are not switched on for this environment. The flags above do not need them.</p>
        )
      ) : null}
    </Panel>
  );
}

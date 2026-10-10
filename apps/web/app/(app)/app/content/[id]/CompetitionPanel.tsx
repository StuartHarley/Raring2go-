import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { readCompetitionEntries } from "../../../../../lib/competition-runtime";
import { formatCount, formatDate } from "../../../../../lib/format";
import { EmptyState, Notice, Panel, RecordCard, RecordList } from "../../../../../lib/page-ui";
import { drawWinnersAction } from "./competition-actions";

const messages: Record<string, string> = {
  drawn: "The winners have been drawn. They are listed below; contact them directly.",
  draw_still_open: "This competition is still open. Winners can be drawn once it has closed.",
  draw_no_end_date: "This competition has no closing date, so it cannot be drawn. Set one on the content first.",
  draw_already_drawn: "This competition has already been drawn. A draw is never repeated.",
  draw_no_entries: "Nobody entered this competition.",
  draw_bad_count: "Choose between 1 and 10 winners.",
  draw_not_allowed: "You do not have permission to draw this competition.",
  draw_not_found: "That competition was not found."
};

/** Entries and the draw for a competition. Entrants are only counted; winners' emails are shown to people who may draw. */
export async function CompetitionPanel({ request, contentId, resultCode }: { request: RequestedShellContext; contentId: string; resultCode?: string }) {
  const shell = await requireShellPermission(request, { module: "content", action: "view" });
  const data = await readCompetitionEntries({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId }, contentId);
  const message = resultCode ? messages[resultCode] : undefined;
  const standing =
    data.state === "no_end_date"
      ? "No closing date is set, so nobody can enter yet."
      : data.state === "open"
        ? `Open for entries until ${formatDate(data.closesOn)}.`
        : `Closed on ${formatDate(data.closesOn)}.`;
  return (
    <Panel eyebrow="Competition" title="Entries and draw" intro={`${formatCount(data.entryCount, "entry", "entries")}. ${standing}`} id="competition">
      {message ? <Notice tone={resultCode === "drawn" ? "success" : "error"}>{message}</Notice> : null}
      <p className="muted">Entries hold only who entered and when. Entering does not sign anyone up to emails. Entries that do not win are deleted 90 days after they were made; winners after 12 months.</p>
      {data.drawn ? (
        <RecordList>
          {data.winners.map((winner) => (
            <RecordCard
              key={winner.entryId}
              title="Winner"
              status="drawn"
              tone="success"
              lines={[
                data.canDraw ? winner.email ?? "Contact details removed" : "Contact details are shown to people who can draw",
                `Drawn ${formatDate(winner.drawnAt)}`
              ]}
            />
          ))}
        </RecordList>
      ) : data.canDraw && data.state === "closed" && data.entryCount > 0 ? (
        <form action={drawWinnersAction.bind(null, request, contentId)} className="franchise-form">
          <label>
            Number of winners
            <input name="winnerCount" type="number" min={1} max={10} defaultValue={1} required />
          </label>
          <button type="submit" className="r2-button r2-button--primary">
            Draw winners
          </button>
          <p className="muted">The draw is random and can only be done once.</p>
        </form>
      ) : data.state === "closed" && data.entryCount === 0 ? (
        <EmptyState title="Nobody entered">The competition closed without any entries, so there is nothing to draw.</EmptyState>
      ) : null}
    </Panel>
  );
}

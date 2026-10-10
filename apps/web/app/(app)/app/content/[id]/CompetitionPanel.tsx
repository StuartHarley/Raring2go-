import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { readCompetitionEntries } from "../../../../../lib/competition-runtime";
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
  return (
    <section id="competition" className="app-panel franchise-panel" aria-label="Competition entries">
      <p className="eyebrow">Competition</p>
      <h2>Entries and draw</h2>
      {message ? <p role={resultCode === "drawn" ? "status" : "alert"}>{message}</p> : null}
      <p>
        {data.entryCount} {data.entryCount === 1 ? "entry" : "entries"}.{" "}
        {data.state === "no_end_date" ? "No closing date is set, so nobody can enter yet." : data.state === "open" ? `Open for entries until ${data.closesOn}.` : `Closed on ${data.closesOn}.`}
      </p>
      <p className="muted">Entries hold only who entered and when. Entering does not sign anyone up to emails. Entries that do not win are deleted 90 days after they were made; winners after 12 months.</p>
      {data.drawn ? (
        <div className="franchise-list" aria-label="Winners">
          {data.winners.map((winner) => (
            <div key={winner.entryId}>
              <strong>Winner</strong>
              <span>{data.canDraw ? winner.email ?? "Contact details removed" : "Contact details are shown to people who can draw"}</span>
              <span className="muted">Drawn {winner.drawnAt?.toISOString().slice(0, 10)}</span>
            </div>
          ))}
        </div>
      ) : data.canDraw && data.state === "closed" && data.entryCount > 0 ? (
        <form action={drawWinnersAction.bind(null, request, contentId)} className="franchise-form">
          <label>Number of winners<input name="winnerCount" type="number" min={1} max={10} defaultValue={1} required /></label>
          <button type="submit">Draw winners</button>
          <p className="muted">The draw is random and can only be done once.</p>
        </form>
      ) : null}
    </section>
  );
}

import { AccessInputError } from "@raring2go/access";
import { requireShellPermission } from "../../../../lib/app-shell";
import { readFranchiseTeamAsActor } from "../../../../lib/access-runtime";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { inviteStaffAction, removeStaffAction, revokeStaffInvitationAction } from "./actions";
import type { TeamResult } from "./actions";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const banners: Record<TeamResult, { tone: "success" | "error"; text: string }> = {
  invited: { tone: "success", text: "Invitation sent. Inviting the same address again replaces the earlier link." },
  invited_email_failed: { tone: "error", text: "The invitation was created but the email could not be sent. Invite them again to retry; that replaces the unsent link." },
  removed: { tone: "success", text: "They no longer have access. The history is kept." },
  invitation_revoked: { tone: "success", text: "Invitation withdrawn." },
  not_allowed: { tone: "error", text: "You do not have permission to do that." },
  seat_limit: { tone: "error", text: "Your team has reached its seat limit. Remove someone first, or ask Head Office." },
  invalid_input: { tone: "error", text: "Check the email address and try again." },
  wrong_state: { tone: "error", text: "That could not be done: they may already be on your team, or it was already done." }
};

export default async function TeamPage({ searchParams }: PageProps) {
  const search = await searchParams;
  const request = await requestFromSearchParamsAndCookies(search);
  const code = Array.isArray(search.result) ? search.result[0] : search.result;
  const banner = code && code in banners ? banners[code as TeamResult] : null;

  let shell;
  try {
    shell = await requireShellPermission(request, { module: "franchise.team", action: "view" });
  } catch (error) {
    return protectedOutcome(error);
  }
  let team;
  try {
    team = await readFranchiseTeamAsActor({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (!(error instanceof AccessInputError)) throw error;
    return (
      <AppShell request={request}>
        <section className="app-panel franchise-panel">
          <p className="eyebrow">My team</p>
          <h2>Choose your franchise first</h2>
          <p>Your team belongs to one franchise territory. Switch to it from the context menu, then come back.</p>
        </section>
      </AppShell>
    );
  }

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">My team</p>
        <h2>{shell.activeContext.territoryName ?? "Your territory"} team</h2>
        <p>
          Franchise Staff can work on advertisers, draft content, newsletters and social posts, and see your obligations. They cannot book, send,
          approve, invoice, see finance, or manage people. You can have {team.seats.limit} people on your team ({team.seats.used} used, including invitations).
        </p>
        {banner ? <p role={banner.tone === "error" ? "alert" : "status"} className="app-banner">{banner.text}</p> : null}
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Team</p>
        <h2>{team.staff.length === 0 ? "No staff yet" : `${team.staff.length} on your team`}</h2>
        <div className="franchise-list">
          {team.staff.map((member) => (
            <div key={member.id}>
              <strong>{member.userName ?? member.userEmail}</strong>
              <span>{member.roleName} - {member.userEmail}</span>
              {team.canManage ? <form action={removeStaffAction.bind(null, request, member.id)}><button type="submit">Remove</button></form> : null}
            </div>
          ))}
          {team.invitations.map((invitation) => (
            <div key={invitation.id}>
              <strong>{invitation.email}</strong>
              <span>Invited, not yet accepted - expires {invitation.expiresAt.toISOString().slice(0, 10)}</span>
              {team.canManage ? <form action={revokeStaffInvitationAction.bind(null, request, invitation.id)}><button type="submit">Withdraw</button></form> : null}
            </div>
          ))}
        </div>
      </section>

      {team.canManage ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Invite</p>
          <h2>Add a team member</h2>
          <form action={inviteStaffAction.bind(null, request)} className="franchise-form">
            <label>Email<input name="email" type="email" required autoComplete="off" maxLength={254} /></label>
            <button type="submit">Send invitation</button>
          </form>
        </section>
      ) : null}
    </AppShell>
  );
}

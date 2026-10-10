import { AccessInputError } from "@raring2go/access";
import { requireShellPermission } from "../../../../lib/app-shell";
import { readFranchiseTeamAsActor } from "../../../../lib/access-runtime";
import { formatCount, formatDate } from "../../../../lib/format";
import { EmptyState, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { protectedOutcome } from "../../../../lib/protected-outcome";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { inviteStaffAction, removeStaffAction, revokeStaffInvitationAction } from "./actions";
import type { TeamResult } from "./actions";

export const metadata = { title: "My team" };

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
    return protectedOutcome(error, request);
  }
  let team;
  try {
    team = await readFranchiseTeamAsActor({ userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId });
  } catch (error) {
    if (!(error instanceof AccessInputError)) throw error;
    return (
      <AppShell request={request}>
        <PageHeader eyebrow="Franchise" title="My team" intro="The people who work in your franchise territory with you." />
        <Panel>
          <EmptyState title="Choose your franchise first">Your team belongs to one franchise territory. Switch to it from the context menu, then come back.</EmptyState>
        </Panel>
      </AppShell>
    );
  }

  const seatsFull = team.seats.used >= team.seats.limit;

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Franchise"
        title={`${shell.activeContext.territoryName ?? "Your territory"} team`}
        intro={`Franchise Staff can work on advertisers, draft content, newsletters and social posts, and see your obligations. They cannot book, send, approve, invoice, see finance, or manage people. You can have ${formatCount(team.seats.limit, "person", "people")} on your team, counting invitations.`}
      />

      {banner ? <Notice tone={banner.tone}>{banner.text}</Notice> : null}

      <Panel>
        <Metrics
          items={[
            { label: "On your team", value: team.staff.length },
            { label: "Invitations waiting", value: team.invitations.length, tone: team.invitations.length > 0 ? "warning" : "neutral" },
            { label: "Seats used", value: `${team.seats.used} of ${team.seats.limit}`, tone: seatsFull ? "warning" : "success" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Team" title="People">
        {team.staff.length === 0 && team.invitations.length === 0 ? (
          <EmptyState title="No staff yet">{team.canManage ? "Invite someone below and they join as Franchise Staff once they accept." : "Nobody has been invited to this team yet."}</EmptyState>
        ) : (
          <RecordList>
            {team.staff.map((member) => (
              <RecordCard key={member.id} title={member.userName ?? member.userEmail} status={member.userStatus} lines={[`${member.roleName} · ${member.userEmail}`]}>
                {team.canManage ? (
                  <form action={removeStaffAction.bind(null, request, member.id)}>
                    <button type="submit" className="r2-button r2-button--danger">Remove</button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
            {team.invitations.map((invitation) => (
              <RecordCard key={invitation.id} title={invitation.email} status="invited" tone="warning" lines={[`Not yet accepted · expires ${formatDate(invitation.expiresAt)}`]}>
                {team.canManage ? (
                  <form action={revokeStaffInvitationAction.bind(null, request, invitation.id)}>
                    <button type="submit" className="r2-button r2-button--secondary">Withdraw</button>
                  </form>
                ) : null}
              </RecordCard>
            ))}
          </RecordList>
        )}
      </Panel>

      {team.canManage ? (
        <Panel eyebrow="Invite" title="Add a team member" intro="They get an email link to join as Franchise Staff.">
          <form action={inviteStaffAction.bind(null, request)} className="franchise-form">
            <label>Email<input name="email" type="email" required autoComplete="off" maxLength={254} /></label>
            <button type="submit" className="r2-button r2-button--primary">Send invitation</button>
          </form>
        </Panel>
      ) : null}
    </AppShell>
  );
}

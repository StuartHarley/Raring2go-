/** Result codes the access actions redirect with, and what each one says. Looked up, never reflected. */
export const resultMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  role_created: { tone: "success", text: "Role created. Add permissions to it, then give it to people." },
  grant_added: { tone: "success", text: "Permission added. It applies to everyone holding this role, usually within seconds." },
  grant_removed: { tone: "success", text: "Permission removed from the role." },
  role_deleted: { tone: "success", text: "Role deleted." },
  assigned: { tone: "success", text: "Role given. It takes effect on their next page load." },
  revoked: { tone: "success", text: "Role ended. The history is kept." },
  invited: { tone: "success", text: "Invitation sent. Inviting the same person again replaces the earlier link." },
  invited_email_failed: { tone: "error", text: "The invitation was created but the email could not be sent. Invite them again to retry; that replaces the unsent link." },
  invitation_revoked: { tone: "success", text: "Invitation withdrawn." },
  not_allowed: { tone: "error", text: "You do not have permission to do that here." },
  escalation: { tone: "error", text: "You cannot give out access you do not hold yourself, or at a wider scope than you hold it." },
  last_administrator: { tone: "error", text: "That would leave nobody able to administer roles and permissions, so it was not done." },
  invalid_input: { tone: "error", text: "Some of what you entered is not valid. Check the fields and try again." },
  wrong_state: { tone: "error", text: "That could not be done in the current state: it may already be done, or something it depends on is missing." }
};

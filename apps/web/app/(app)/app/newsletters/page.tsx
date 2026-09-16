import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { hasAiAssistCapability } from "../../../../lib/ai-runtime";
import { listConnectionCards } from "../../../../lib/integrations-runtime";
import { readEmailCampaignOverview, readSegments, readSubjectLineComparison } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { CampaignComposeFields } from "./CampaignComposeFields";
import {
  acceptAiSuggestionAction,
  approveCampaignAction,
  composeEmailCampaignAction,
  declareWinnerAction,
  generateSnapshotAction,
  generateWinnerRemainderSnapshotAction,
  scheduleCampaignAction,
  sendCampaignAction,
  startAbTestAction,
  suggestBlockCopyAction,
  suggestSubjectLinesAction
} from "./actions";
import { normalizeContentSnapshot } from "@raring2go/marketing";
import type { AudienceSegment, EmailCampaignOverview } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewslettersPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadNewsletters(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const { context, email, composableSegments, outlookMailboxes, aiAssistAvailable, lastNewsletter, comparisons } = result;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Native email</p>
        <h2>Newsletter campaigns</h2>
        <p>
          {context.territoryId
            ? "Send a local newsletter to your own territory's audience."
            : "Send a national newsletter to every subscribed audience across the network."}
        </p>
        <p>
          <a href="/app/newsletters/factory">Open HQ newsletter factory</a>
          {" · "}
          <a href="/app/audience/segments">Build an audience segment</a>
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Campaigns</span>
            <strong>{email.totals.campaigns}</strong>
          </article>
          <article>
            <span>Draft</span>
            <strong>{email.totals.draft}</strong>
          </article>
          <article>
            <span>Scheduled</span>
            <strong>{email.totals.scheduled}</strong>
          </article>
          <article>
            <span>Sent</span>
            <strong>{email.totals.sent}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Compose</p>
        <h2>{context.territoryId ? "Compose a local newsletter" : "Compose a newsletter"}</h2>
        {composableSegments.length === 0 ? (
          <p>No audience segment is configured yet. Ask HQ to set one up before composing a campaign.</p>
        ) : (
          <form action={composeEmailCampaignAction.bind(null, context)} className="newsletter-compose-form">
            <div className="newsletter-compose-section">
              <h3 className="newsletter-compose-section-title">Audience &amp; delivery</h3>
              <label>
                Audience
                <select name="segmentId" required>
                  {composableSegments.map((segment) => (
                    <option key={segment.id} value={segment.id}>
                      {segment.name}
                      {segment.territoryId ? "" : " (all territories - national)"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Preheader
                <input type="text" name="preheader" />
              </label>
              <label>
                Send via
                <select name="sendChoice" defaultValue="postmark">
                  <option value="postmark">Network email (Postmark)</option>
                  {outlookMailboxes.map((mailbox) => (
                    <option key={mailbox.id} value={`microsoft:${mailbox.id}`}>
                      My Outlook mailbox ({mailbox.externalAccountDisplayName})
                    </option>
                  ))}
                </select>
              </label>
              {outlookMailboxes.length > 0 ? (
                <p>
                  Sending via Outlook is limited to small local sends and doesn&apos;t report delivery, bounce or open
                  tracking. Use the network provider for national or large-audience campaigns.
                </p>
              ) : null}
            </div>
            <div className="newsletter-compose-section">
              <h3 className="newsletter-compose-section-title">Content</h3>
              <CampaignComposeFields
                aiAssistAvailable={aiAssistAvailable}
                lastNewsletter={lastNewsletter}
                suggestSubjectLinesAction={suggestSubjectLinesAction.bind(null, context)}
                suggestBlockCopyAction={suggestBlockCopyAction.bind(null, context)}
                acceptAiSuggestionAction={acceptAiSuggestionAction.bind(null, context)}
              />
            </div>
            <button type="submit">Create draft campaign</button>
          </form>
        )}
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Campaigns</p>
        <h2>Native campaign records</h2>
        <div className="franchise-list">
          {email.campaigns.length === 0 ? (
            <div>
              <strong>No campaigns yet</strong>
              <span>Compose a national or local newsletter above to get started.</span>
            </div>
          ) : (
            email.campaigns.map((view) => {
              const canAct = !context.territoryId || context.territoryId === view.campaign.territoryId;
              const isAbTest = view.variants.length === 2;
              const comparison = comparisons.get(view.campaign.id);
              // For an A/B campaign, "Send now"/"Schedule" must target the post-winner
              // remainder snapshot, not the small sample snapshot from the test itself
              // (which is what latestSnapshot would otherwise resolve to right after a
              // winner is declared, since the remainder snapshot doesn't exist yet).
              const sendableSnapshot = isAbTest ? view.remainderSnapshot : view.latestSnapshot;

              return (
                <div key={view.campaign.id}>
                  <strong>
                    {view.campaign.title} {view.campaign.territoryId ? "" : "(national)"}
                  </strong>
                  <span>{view.campaign.status} - {view.latestSnapshot?.recipientCount ?? 0} recipients</span>
                  <span>{view.deliveryCount} delivery events</span>
                  {view.campaign.sendProvider === "microsoft" ? (
                    <span>Sent via Outlook - delivery, bounce and open tracking is not available for this campaign</span>
                  ) : null}
                  {!canAct ? <span>Managed by HQ</span> : null}

                  {canAct && view.campaign.status === "draft" && isAbTest ? (
                    <form action={startAbTestAction.bind(null, context, view.campaign.id)} className="franchise-form">
                      <p>
                        Subject A: {view.variants[0]!.version.subject} · Subject B: {view.variants[1]!.version.subject}
                      </p>
                      <label>
                        Test sample size (% of audience)
                        <input type="number" name="sampleFraction" min={2} max={50} defaultValue={20} />
                      </label>
                      <button type="submit">Start subject-line test</button>
                    </form>
                  ) : null}

                  {canAct && view.campaign.status === "draft" && !isAbTest && view.latestVersion ? (
                    <form action={approveCampaignAction.bind(null, context, view.campaign.id, view.latestVersion.id)}>
                      <button type="submit">Approve</button>
                    </form>
                  ) : null}

                  {view.campaign.status === "testing" ? (
                    <div className="newsletter-ab-test-comparison">
                      {view.variants.map((variant) => {
                        const stats = comparison?.variants.find((candidate) => candidate.version.id === variant.version.id);
                        return (
                          <div key={variant.version.id}>
                            <strong>Variant {variant.version.variantKey?.toUpperCase()}: {variant.version.subject}</strong>
                            <span>{variant.snapshot?.recipientCount ?? 0} sent to sample</span>
                            {stats ? (
                              <span>
                                {stats.delivered} delivered · {stats.opened} opened
                                {stats.openRate !== null ? ` · ${Math.round(stats.openRate * 100)}% open rate` : ""}
                              </span>
                            ) : null}
                            {canAct && comparison?.canDeclareWinner ? (
                              <form action={declareWinnerAction.bind(null, context, view.campaign.id, variant.version.id)}>
                                <button type="submit">Declare this the winner</button>
                              </form>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && isAbTest ? (
                    <>
                      <p>Winner: {view.variants.find((variant) => variant.version.status === "approved")?.version.subject}</p>
                      {!view.remainderSnapshot ? (
                        <form action={generateWinnerRemainderSnapshotAction.bind(null, context, view.campaign.id)}>
                          <button type="submit">Generate recipient snapshot for the rest of the audience</button>
                        </form>
                      ) : null}
                    </>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && !isAbTest ? (
                    <form action={generateSnapshotAction.bind(null, context, view.campaign.id)}>
                      <button type="submit">Generate recipient snapshot</button>
                    </form>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && sendableSnapshot ? (
                    <>
                      <form action={sendCampaignAction.bind(null, context, view.campaign.id)}>
                        <button type="submit">Send now</button>
                      </form>
                      <form action={scheduleCampaignAction.bind(null, context, view.campaign.id)} className="franchise-form">
                        <label>
                          Send at
                          <input type="datetime-local" name="scheduledAt" required />
                        </label>
                        <button type="submit">Schedule</button>
                      </form>
                    </>
                  ) : null}
                  {(view.campaign.status === "scheduled" || view.campaign.status === "sending") && view.activeJob ? (
                    <span>
                      Sending: {view.activeJob.cursor}/{view.latestSnapshot?.recipientCount ?? 0} sent
                      {view.campaign.status === "scheduled" ? ` (starts ${new Date(view.campaign.scheduledAt ?? "").toLocaleString()})` : ""}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    </AppShell>
  );
}

async function loadNewsletters(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "marketing.email",
      action: "view"
    });
    const context: MarketingActorContext = {
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    };
    const [email, segments, outlookConnections] = await Promise.all([
      readEmailCampaignOverview(context),
      readSegments(context).catch(() => [] as AudienceSegment[]),
      listConnectionCards(request, "microsoft", "outlook_mailbox")
        .then((result) => result.connections)
        .catch(() => [] as Awaited<ReturnType<typeof listConnectionCards>>["connections"])
    ]);
    const composableSegments = context.territoryId
      ? segments.filter((segment) => segment.territoryId === context.territoryId)
      : segments;
    const outlookMailboxes = outlookConnections.filter((connection) => connection.status === "connected");
    const lastNewsletter = findLastNewsletter(email.campaigns);
    const testingCampaigns = email.campaigns.filter((view) => view.campaign.status === "testing");
    const comparisonEntries = await Promise.all(
      testingCampaigns.map(async (view) => {
        const comparison = await readSubjectLineComparison(context, view.campaign.id).catch(() => undefined);
        return [view.campaign.id, comparison] as const;
      })
    );
    const comparisons = new Map(comparisonEntries.filter(([, comparison]) => comparison !== undefined));

    return {
      context,
      email,
      composableSegments,
      outlookMailboxes,
      aiAssistAvailable: hasAiAssistCapability(context),
      lastNewsletter,
      comparisons
    };
  } catch (error) {
    return { error };
  }
}

function protectedOutcome(error: unknown) {
  if (error instanceof ShellAccessError) {
    return (
      <main className={`app-outcome app-outcome-${error.kind}`}>
        <section>
          <p className="eyebrow">{error.kind.replace("_", " ")}</p>
          <h1>{error.kind === "unauthenticated" ? "Sign in required" : "Access denied"}</h1>
          <p>{error.message}</p>
        </section>
      </main>
    );
  }

  throw error;
}

function findLastNewsletter(campaigns: EmailCampaignOverview["campaigns"]) {
  const candidates = campaigns
    .filter((view) => !view.campaign.deletedAt && view.latestVersion)
    .sort((left, right) => {
      const leftDate = left.campaign.sentAt ?? left.campaign.scheduledAt ?? left.campaign.approvedAt ?? "";
      const rightDate = right.campaign.sentAt ?? right.campaign.scheduledAt ?? right.campaign.approvedAt ?? "";
      return rightDate.localeCompare(leftDate);
    });
  const latest = candidates[0];

  if (!latest?.latestVersion) {
    return undefined;
  }

  const snapshot = normalizeContentSnapshot(latest.latestVersion.contentSnapshot, latest.campaign.title);

  return {
    title: latest.campaign.title,
    subject: latest.latestVersion.subject,
    blocks: snapshot.blocks
  };
}

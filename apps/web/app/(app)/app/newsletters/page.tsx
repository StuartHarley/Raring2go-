import type { Route } from "next";
import { requireShellPermission } from "../../../../lib/app-shell";
import { hasAiAssistCapability } from "../../../../lib/ai-runtime";
import { listConnectionCards } from "../../../../lib/integrations-runtime";
import { readEmailCampaignOverview, readSegments, readSubjectLineComparison } from "../../../../lib/marketing-runtime";
import { formatCount, formatDateTime } from "../../../../lib/format";
import { Actions, EmptyState, LinkButton, Metrics, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import { CampaignComposeFields } from "./CampaignComposeFields";
import {
  acceptAiSuggestionAction,
  approveCampaignAction,
  composeEmailCampaignAction,
  declareWinnerAction,
  generateCampaignDraftAction,
  generateSnapshotAction,
  generateWinnerRemainderSnapshotAction,
  scheduleCampaignAction,
  scheduleWithSendTimeOptimizationAction,
  sendCampaignAction,
  startAbTestAction,
  suggestBlockCopyAction,
  suggestSubjectLinesAction
} from "./actions";
import { normalizeContentSnapshot } from "@raring2go/marketing";
import type { AudienceSegment, EmailCampaignOverview, EmailSendJob } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import { getPermissionData } from "../../../../lib/permission-source";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Newsletters" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewslettersPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadNewsletters(request);

  if ("error" in result) {
    return protectedOutcome(result.error, request);
  }

  const { context, email, composableSegments, outlookMailboxes, aiAssistAvailable, lastNewsletter, comparisons } = result;

  return (
    <AppShell request={request}>
      <PageHeader
        eyebrow="Marketing"
        title="Newsletters"
        intro={
          context.territoryId
            ? "Write and send a newsletter to the families subscribed in your area, and see how past sends went."
            : "Write and send a newsletter to every subscribed audience across the network, and see how past sends went."
        }
        actions={
          <>
            <LinkButton href={"#compose" as Route}>Compose a newsletter</LinkButton>
            <LinkButton href={"/app/newsletters/factory" as Route} variant="secondary">
              Newsletter factory
            </LinkButton>
            <LinkButton href={"/app/audience/segments" as Route} variant="secondary">
              Audience segments
            </LinkButton>
          </>
        }
      />

      <Panel>
        <Metrics
          items={[
            { label: "Campaigns", value: email.totals.campaigns },
            { label: "Drafts", value: email.totals.draft },
            { label: "Scheduled", value: email.totals.scheduled, tone: email.totals.scheduled > 0 ? "info" : "neutral" },
            { label: "Sent", value: email.totals.sent, tone: email.totals.sent > 0 ? "success" : "neutral" }
          ]}
        />
      </Panel>

      <Panel eyebrow="Compose" title={context.territoryId ? "Compose a local newsletter" : "Compose a newsletter"} id="compose">
        {composableSegments.length === 0 ? (
          <EmptyState title="No audience to send to yet">Ask Head Office to set up an audience segment before composing a campaign.</EmptyState>
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
                segments={composableSegments}
                suggestSubjectLinesAction={suggestSubjectLinesAction.bind(null, context)}
                suggestBlockCopyAction={suggestBlockCopyAction.bind(null, context)}
                acceptAiSuggestionAction={acceptAiSuggestionAction.bind(null, context)}
                generateCampaignDraftAction={generateCampaignDraftAction.bind(null, context)}
              />
            </div>
            <button type="submit" className="r2-button r2-button--primary">
              Create draft campaign
            </button>
          </form>
        )}
      </Panel>

      <Panel eyebrow="Campaigns" title="All campaigns" id="campaigns">
        {email.campaigns.length === 0 ? (
          <EmptyState title="No campaigns yet">Compose a newsletter above and it will appear here as a draft.</EmptyState>
        ) : (
          <RecordList>
            {email.campaigns.map((view) => {
              const canAct = !context.territoryId || context.territoryId === view.campaign.territoryId;
              const isAbTest = view.variants.length === 2;
              const comparison = comparisons.get(view.campaign.id);
              // For an A/B campaign, "Send now"/"Schedule" must target the post-winner
              // remainder snapshot, not the small sample snapshot from the test itself
              // (which is what latestSnapshot would otherwise resolve to right after a
              // winner is declared, since the remainder snapshot doesn't exist yet).
              const sendableSnapshot = isAbTest ? view.remainderSnapshot : view.latestSnapshot;

              return (
                <RecordCard
                  key={view.campaign.id}
                  title={view.campaign.territoryId ? view.campaign.title : `${view.campaign.title} (national)`}
                  status={view.campaign.status}
                  lines={[
                    `${formatCount(view.latestSnapshot?.recipientCount ?? 0, "recipient")} · ${formatCount(view.deliveryCount, "delivery event")}`,
                    view.campaign.sendProvider === "microsoft"
                      ? "Sent via Outlook - delivery, bounce and open tracking is not available for this campaign"
                      : null,
                    !canAct ? "Managed by Head Office" : null
                  ]}
                >
                  {canAct && view.campaign.status === "draft" && isAbTest ? (
                    <form action={startAbTestAction.bind(null, context, view.campaign.id)} className="franchise-form">
                      <p>
                        Subject A: {view.variants[0]!.version.subject} · Subject B: {view.variants[1]!.version.subject}
                      </p>
                      <label>
                        Test sample size (% of audience)
                        <input type="number" name="sampleFraction" min={2} max={50} defaultValue={20} />
                      </label>
                      <button type="submit" className="r2-button r2-button--primary">
                        Start subject-line test
                      </button>
                    </form>
                  ) : null}

                  {canAct && view.campaign.status === "draft" && !isAbTest && view.latestVersion ? (
                    <form action={approveCampaignAction.bind(null, context, view.campaign.id, view.latestVersion.id)}>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--primary">
                          Approve
                        </button>
                      </Actions>
                    </form>
                  ) : null}

                  {view.campaign.status === "testing" ? (
                    <div className="newsletter-ab-test-comparison">
                      {view.variants.map((variant) => {
                        const stats = comparison?.variants.find((candidate) => candidate.version.id === variant.version.id);
                        return (
                          <div key={variant.version.id}>
                            <strong>
                              Variant {variant.version.variantKey?.toUpperCase()}: {variant.version.subject}
                            </strong>
                            <span>{variant.snapshot?.recipientCount ?? 0} sent to sample</span>
                            {stats ? (
                              <span>
                                {stats.delivered} delivered · {stats.opened} opened
                                {stats.openRate !== null ? ` · ${Math.round(stats.openRate * 100)}% open rate` : ""}
                              </span>
                            ) : null}
                            {canAct && comparison?.canDeclareWinner ? (
                              <form action={declareWinnerAction.bind(null, context, view.campaign.id, variant.version.id)}>
                                <button type="submit" className="r2-button r2-button--secondary">
                                  Declare this the winner
                                </button>
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
                          <Actions>
                            <button type="submit" className="r2-button r2-button--primary">
                              Generate recipient snapshot for the rest of the audience
                            </button>
                          </Actions>
                        </form>
                      ) : null}
                    </>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && !isAbTest ? (
                    <form action={generateSnapshotAction.bind(null, context, view.campaign.id)}>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Generate recipient snapshot
                        </button>
                      </Actions>
                    </form>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && sendableSnapshot ? (
                    <>
                      <form action={sendCampaignAction.bind(null, context, view.campaign.id)}>
                        <Actions>
                          <button type="submit" className="r2-button r2-button--primary">
                            Send now
                          </button>
                        </Actions>
                      </form>
                      <form action={scheduleCampaignAction.bind(null, context, view.campaign.id)} className="franchise-form">
                        <label>
                          Send at
                          <input type="datetime-local" name="scheduledAt" required />
                        </label>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Schedule
                        </button>
                      </form>
                    </>
                  ) : null}

                  {canAct && view.campaign.status === "approved" && !isAbTest ? (
                    <form action={scheduleWithSendTimeOptimizationAction.bind(null, context, view.campaign.id)} className="franchise-form">
                      <label>
                        Send at (earliest)
                        <input type="datetime-local" name="scheduledAt" required />
                      </label>
                      <label>
                        Default hour for contacts with no engagement history (UTC, 0-23)
                        <input type="number" name="defaultHour" min={0} max={23} defaultValue={9} />
                      </label>
                      <button type="submit" className="r2-button r2-button--secondary">
                        Schedule with send-time optimisation
                      </button>
                    </form>
                  ) : null}

                  {view.sendJobs.length > 1 ? (
                    <div className="newsletter-sto-progress">
                      <span>
                        Optimised send: {view.sendJobs.filter((entry) => entry.job.status === "completed").length}/{view.sendJobs.length} send windows complete
                        {" · "}
                        {view.sendJobs.reduce((total, entry) => total + entry.job.cursor, 0)}/
                        {view.sendJobs.reduce((total, entry) => total + (entry.snapshot?.recipientCount ?? 0), 0)} sent
                      </span>
                      <ul>
                        {view.sendJobs.map((entry) => (
                          <li key={entry.job.id}>{describeSendWindow(entry.job, entry.snapshot?.recipientCount ?? 0)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (view.campaign.status === "scheduled" || view.campaign.status === "sending") && view.activeJob ? (
                    <span className="record-card__line">
                      Sending: {view.activeJob.cursor}/{view.latestSnapshot?.recipientCount ?? 0} sent
                      {view.campaign.status === "scheduled" ? ` (starts ${formatDateTime(view.campaign.scheduledAt)})` : ""}
                    </span>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

function describeSendWindow(job: EmailSendJob, recipientCount: number): string {
  const time = formatDateTime(job.nextAttemptAt);

  switch (job.status) {
    case "completed":
      return `${time} window — sent to ${job.cursor} of ${recipientCount}`;
    case "processing":
      return `${time} window — sending now (${job.cursor} of ${recipientCount})`;
    case "failed":
      return `${time} window — failed after ${job.cursor} of ${recipientCount}`;
    case "queued":
    default:
      return `${time} window — waiting to start`;
  }
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
      aiAssistAvailable: hasAiAssistCapability(await getPermissionData(), context),
      lastNewsletter,
      comparisons
    };
  } catch (error) {
    return { error };
  }
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

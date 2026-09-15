import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readEmailCampaignOverview, readSegments } from "../../../../lib/marketing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";
import {
  approveCampaignAction,
  composeEmailCampaignAction,
  generateSnapshotAction,
  scheduleCampaignAction,
  sendCampaignAction
} from "./actions";
import type { AudienceSegment } from "@raring2go/marketing";
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

  const { context, email, composableSegments } = result;

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
          <form action={composeEmailCampaignAction.bind(null, context)} className="franchise-form">
            <label>
              Title
              <input type="text" name="title" required />
            </label>
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
              Subject
              <input type="text" name="subject" required />
            </label>
            <label>
              Preheader
              <input type="text" name="preheader" />
            </label>
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

              return (
                <div key={view.campaign.id}>
                  <strong>
                    {view.campaign.title} {view.campaign.territoryId ? "" : "(national)"}
                  </strong>
                  <span>{view.campaign.status} - {view.latestSnapshot?.recipientCount ?? 0} recipients</span>
                  <span>{view.deliveryCount} delivery events</span>
                  {!canAct ? <span>Managed by HQ</span> : null}
                  {canAct && view.campaign.status === "draft" && view.latestVersion ? (
                    <form action={approveCampaignAction.bind(null, context, view.campaign.id, view.latestVersion.id)}>
                      <button type="submit">Approve</button>
                    </form>
                  ) : null}
                  {canAct && view.campaign.status === "approved" ? (
                    <form action={generateSnapshotAction.bind(null, context, view.campaign.id)}>
                      <button type="submit">Generate recipient snapshot</button>
                    </form>
                  ) : null}
                  {canAct && view.campaign.status === "approved" && view.latestSnapshot ? (
                    <form action={scheduleCampaignAction.bind(null, context, view.campaign.id)} className="franchise-form">
                      <label>
                        Send at
                        <input type="datetime-local" name="scheduledAt" required />
                      </label>
                      <button type="submit">Schedule</button>
                    </form>
                  ) : null}
                  {canAct && view.campaign.status === "scheduled" ? (
                    <form action={sendCampaignAction.bind(null, context, view.campaign.id)}>
                      <button type="submit">Send now</button>
                    </form>
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
    const [email, segments] = await Promise.all([
      readEmailCampaignOverview(context),
      readSegments(context).catch(() => [] as AudienceSegment[])
    ]);
    const composableSegments = context.territoryId
      ? segments.filter((segment) => segment.territoryId === context.territoryId)
      : segments;

    return { context, email, composableSegments };
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

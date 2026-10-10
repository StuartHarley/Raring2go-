import { requireShellPermission } from "../../../../lib/app-shell";
import { readSocialQueue } from "../../../../lib/publishing-runtime";
import { formatDateTime, formatLabel, formatLabels } from "../../../../lib/format";
import { Actions, EmptyState, Metrics, Notice, PageHeader, Panel, RecordCard, RecordList } from "../../../../lib/page-ui";
import { approveSocialAction, cancelSocialAction, queueSocialAction, resolveSocialAction, retrySocialAction, scheduleSocialAction } from "./actions";
import type { SocialResult } from "./actions";
import { requestFromSearchParamsAndCookies } from "../page";
import { protectedOutcome } from "../../../../lib/protected-outcome";

export const metadata = { title: "Social queue" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SocialQueuePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const resultCode = Array.isArray(params.result) ? params.result[0] : params.result;
  const result = await loadSocial(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const scheduled = result.queue.filter((item) => item.publication.publishState === "scheduled").length;
  const published = result.queue.filter((item) => item.publication.publishState === "published").length;
  const failed = result.queue.filter((item) => item.publication.publishState === "failed").length;
  const gaps = result.gaps.filter((gap) => gap.signals.length > 0).length;

  return (
    <>
      <SocialBanner result={resultCode} />
      <PageHeader
        eyebrow="Social"
        title="Social queue"
        intro="Posts for each area's Facebook, Instagram and LinkedIn pages: what is queued, what went out and what failed."
      />

      <Panel>
        <Metrics
          items={[
            { label: "In the queue", value: result.queue.length },
            { label: "Scheduled", value: scheduled, tone: scheduled > 0 ? "info" : "neutral" },
            { label: "Published", value: published, tone: published > 0 ? "success" : "neutral" },
            { label: "Failed", value: failed, tone: failed > 0 ? "danger" : "success" },
            { label: "Areas with gaps", value: gaps, tone: gaps > 0 ? "warning" : "success" }
          ]}
        />
      </Panel>

      {result.access.create ? (
        <Panel eyebrow="Queue" title="Queue an approved post">
          {result.queueable.length === 0 ? (
            <EmptyState title="No approved social posts are waiting">
              Approve a Facebook, Instagram or LinkedIn version in Content Studio first, and make sure the area has a connected account.
            </EmptyState>
          ) : (
            <form action={queueSocialAction.bind(null, request)} className="franchise-form">
              <label>
                Post and account
                <select name="target" required>
                  {result.queueable.flatMap((variant) =>
                    variant.accounts.map((account) => (
                      <option key={`${variant.variantId}|${account.id}`} value={`${variant.variantId}|${account.id}`}>
                        {variant.title} ({formatLabel(variant.channel)}) to {account.displayName}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>Link (optional, https only)<input name="linkUrl" type="url" maxLength={300} placeholder="https://" /></label>
              <label>Call to action (optional)<input name="cta" maxLength={80} /></label>
              <Actions>
                <button type="submit" className="r2-button r2-button--primary">
                  Add to the queue
                </button>
              </Actions>
            </form>
          )}
        </Panel>
      ) : null}

      <Panel eyebrow="Queue" title="Upcoming and published posts">
        {result.queue.length === 0 ? (
          <EmptyState title="No social posts queued">Approved social versions can be added to the queue above.</EmptyState>
        ) : (
          <RecordList>
            {result.queue.map((item) => {
              const publication = item.publication;
              const failure = publication.failureMetadata as { reason?: string };
              const unknown = publication.publishState === "failed" && failure.reason === "outcome_unknown";
              const retrying = publication.publishState === "scheduled" && publication.retryCount > 0;
              return (
                <RecordCard
                  key={publication.id}
                  title={item.content?.title ?? "Untitled content"}
                  status={publication.publishState}
                  lines={[
                    `${formatLabel(publication.channel)} · ${item.account?.displayName ?? "Account not connected"}`,
                    `Scheduled for ${formatDateTime(publication.scheduledAt, "a time not set yet")}${retrying && item.job ? ` · retrying after ${formatDateTime(item.job.runAfter)} (attempt ${item.job.attempts} of ${item.job.maxAttempts})` : ""}`,
                    publication.publishState === "published"
                      ? `Posted ${formatDateTime(publication.publishedAt)}${publication.publishedExternalReference ? ` (${publication.publishedExternalReference})` : ""}`
                      : null,
                    publication.publishState === "failed" ? (
                      <span role="alert">
                        {unknown ? "We could not confirm whether this was posted. Check the page before doing anything." : `Failed: ${formatLabel(failure.reason, "Provider failure")}.`}
                      </span>
                    ) : null,
                    item.warnings.length === 0 ? "No warnings" : `Warnings: ${formatLabels(item.warnings)}`
                  ]}
                >
                  {result.access.approve && ["draft", "needs_review"].includes(publication.publishState) ? (
                    <form action={approveSocialAction.bind(null, request, publication.id)}>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Approve
                        </button>
                      </Actions>
                    </form>
                  ) : null}
                  {result.access.schedule && ["approved", "scheduled"].includes(publication.publishState) ? (
                    <form action={scheduleSocialAction.bind(null, request, publication.id)} className="franchise-form">
                      <label>Publish at (UK time)<input name="when" type="datetime-local" required /></label>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--secondary">
                          {publication.publishState === "scheduled" ? "Reschedule" : "Schedule"}
                        </button>
                      </Actions>
                    </form>
                  ) : null}
                  {result.access.schedule && publication.publishState === "failed" && !unknown ? (
                    <form action={retrySocialAction.bind(null, request, publication.id)}>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--secondary">
                          Try again
                        </button>
                      </Actions>
                    </form>
                  ) : null}
                  {result.access.publish && unknown ? (
                    <>
                      <form action={resolveSocialAction.bind(null, request, publication.id, true)} className="franchise-form">
                        <label>It did go out. Post link or id (optional)<input name="reference" maxLength={200} /></label>
                        <Actions>
                          <button type="submit" className="r2-button r2-button--secondary">
                            Mark as posted
                          </button>
                        </Actions>
                      </form>
                      <form action={resolveSocialAction.bind(null, request, publication.id, false)}>
                        <Actions>
                          <button type="submit" className="r2-button r2-button--secondary">
                            It did not go out: queue it again
                          </button>
                        </Actions>
                      </form>
                    </>
                  ) : null}
                  {result.access.cancel && !["published", "cancelled", "publishing"].includes(publication.publishState) ? (
                    <form action={cancelSocialAction.bind(null, request, publication.id)}>
                      <Actions>
                        <button type="submit" className="r2-button r2-button--danger">
                          Cancel
                        </button>
                      </Actions>
                    </form>
                  ) : null}
                </RecordCard>
              );
            })}
          </RecordList>
        )}
      </Panel>

      <Panel eyebrow="Calendar health" title="Content gaps" intro="Areas with nothing scheduled in the next seven days, failed posts, or approved versions not yet queued.">
        {result.gaps.length === 0 ? (
          <EmptyState title="No active areas to check" />
        ) : (
          <RecordList>
            {result.gaps.map((gap) => (
              <RecordCard
                key={gap.territoryId}
                title={gap.territoryName}
                status={gap.signals.length === 0 ? "clear" : "watch"}
                lines={[gap.signals.length === 0 ? "Scheduled activity in the next seven days" : formatLabels(gap.signals)]}
              />
            ))}
          </RecordList>
        )}
      </Panel>
    </>
  );
}

async function loadSocial(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "social",
      action: "view"
    });
    const social = await readSocialQueue({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return social;
  } catch (error) {
    return { error };
  }
}

const messages: Record<SocialResult, string> = {
  created: "Added to the queue.",
  saved: "Saved.",
  not_allowed: "You do not have access to do that for this post or area.",
  invalid: "That could not be saved. Check the details and try again.",
  in_past: "A post cannot be scheduled in the past.",
  not_approved: "That post has to be approved first.",
  check_first: "Check whether the post went out before trying again.",
  bad_time: "Choose a valid date and time."
};

/** Banner text is looked up from a fixed set, so nothing in the URL is ever shown. */
function SocialBanner({ result }: { result?: string }) {
  const message = result && Object.hasOwn(messages, result) ? messages[result as SocialResult] : undefined;
  if (!message) return null;
  const good = result === "created" || result === "saved";
  return <Notice tone={good ? "success" : "error"}>{message}</Notice>;
}

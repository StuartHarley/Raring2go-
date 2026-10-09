import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readSocialQueue } from "../../../../lib/publishing-runtime";
import { formatLondon } from "../../../../lib/london-time";
import { AppShell } from "../../layout";
import { approveSocialAction, cancelSocialAction, queueSocialAction, resolveSocialAction, retrySocialAction, scheduleSocialAction } from "./actions";
import type { SocialResult } from "./actions";
import { requestFromSearchParamsAndCookies } from "../page";

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
    <AppShell request={request}>
      <SocialBanner result={resultCode} />
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Social scheduling</p>
        <h2>Publishing queue</h2>
        <p>
          Territory-specific social activity created from approved canonical
          content variants, with provider-neutral publishing jobs.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Queue items</span>
            <strong>{result.queue.length}</strong>
          </article>
          <article>
            <span>Scheduled</span>
            <strong>{scheduled}</strong>
          </article>
          <article>
            <span>Published</span>
            <strong>{published}</strong>
          </article>
          <article>
            <span>Failed</span>
            <strong>{failed}</strong>
          </article>
          <article>
            <span>Gaps</span>
            <strong>{gaps}</strong>
          </article>
        </div>
      </section>

      {result.access.create ? (
        <section className="app-panel franchise-panel">
          <p className="eyebrow">Queue</p>
          <h2>Queue an approved post</h2>
          {result.queueable.length === 0 ? (
            <p>No approved social posts are waiting. Approve a Facebook, Instagram or LinkedIn version in Content Studio first, and make sure the area has a connected account.</p>
          ) : (
            <form action={queueSocialAction.bind(null, request)} className="franchise-form">
              <label>
                Post and account
                <select name="target" required>
                  {result.queueable.flatMap((variant) =>
                    variant.accounts.map((account) => (
                      <option key={`${variant.variantId}|${account.id}`} value={`${variant.variantId}|${account.id}`}>
                        {variant.title} ({variant.channel}) to {account.displayName}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>Link (optional, https only)<input name="linkUrl" type="url" maxLength={300} placeholder="https://" /></label>
              <label>Call to action (optional)<input name="cta" maxLength={80} /></label>
              <button type="submit">Add to the queue</button>
            </form>
          )}
        </section>
      ) : null}

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Queue</p>
        <h2>Upcoming and published posts</h2>
        <div className="franchise-list">
          {result.queue.length === 0 ? (
            <div>
              <strong>No social posts queued</strong>
              <span>Approved social variants can be queued above.</span>
            </div>
          ) : (
            result.queue.map((item) => {
              const publication = item.publication;
              const failure = publication.failureMetadata as { reason?: string };
              const unknown = publication.publishState === "failed" && failure.reason === "outcome_unknown";
              const retrying = publication.publishState === "scheduled" && publication.retryCount > 0;
              return (
                <div key={publication.id}>
                  <strong>{item.content?.title ?? "Untitled content"}</strong>
                  <span>{publication.channel} - {label(publication.publishState)} - {item.account?.displayName ?? "unknown account"}</span>
                  <span>{formatLondon(publication.scheduledAt)}{retrying && item.job ? ` - retrying after ${formatLondon(item.job.runAfter)} (attempt ${item.job.attempts} of ${item.job.maxAttempts})` : ""}</span>
                  {publication.publishState === "published" ? <span>Posted{publication.publishedExternalReference ? ` (${publication.publishedExternalReference})` : ""} {formatLondon(publication.publishedAt)}</span> : null}
                  {publication.publishState === "failed" ? <span role="alert">{unknown ? "We could not confirm whether this was posted. Check the page before doing anything." : `Failed: ${label(failure.reason ?? "provider failure")}.`}</span> : null}
                  <span>{item.warnings.length === 0 ? "No warnings" : item.warnings.map(label).join(", ")}</span>

                  {result.access.approve && ["draft", "needs_review"].includes(publication.publishState) ? (
                    <form action={approveSocialAction.bind(null, request, publication.id)}><button type="submit">Approve</button></form>
                  ) : null}
                  {result.access.schedule && ["approved", "scheduled"].includes(publication.publishState) ? (
                    <form action={scheduleSocialAction.bind(null, request, publication.id)} className="franchise-form">
                      <label>Publish at (UK time)<input name="when" type="datetime-local" required /></label>
                      <button type="submit">{publication.publishState === "scheduled" ? "Reschedule" : "Schedule"}</button>
                    </form>
                  ) : null}
                  {result.access.schedule && publication.publishState === "failed" && !unknown ? (
                    <form action={retrySocialAction.bind(null, request, publication.id)}><button type="submit">Try again</button></form>
                  ) : null}
                  {result.access.publish && unknown ? (
                    <>
                      <form action={resolveSocialAction.bind(null, request, publication.id, true)} className="franchise-form">
                        <label>It did go out. Post link or id (optional)<input name="reference" maxLength={200} /></label>
                        <button type="submit">Mark as posted</button>
                      </form>
                      <form action={resolveSocialAction.bind(null, request, publication.id, false)}>
                        <button type="submit">It did not go out - queue it again</button>
                      </form>
                    </>
                  ) : null}
                  {result.access.cancel && !["published", "cancelled", "publishing"].includes(publication.publishState) ? (
                    <form action={cancelSocialAction.bind(null, request, publication.id)}><button type="submit">Cancel</button></form>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Calendar health</p>
        <h2>Content gaps</h2>
        <div className="franchise-list">
          {result.gaps.map((gap) => (
            <div key={gap.territoryId}>
              <strong>{gap.territoryName}</strong>
              <span>{gap.signals.length === 0 ? "Scheduled activity present" : gap.signals.join(", ")}</span>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
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

const label = (value: string) => value.replaceAll("_", " ");

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
  return <p className={good ? "notice notice--success" : "notice notice--error"} role={good ? "status" : "alert"}>{message}</p>;
}

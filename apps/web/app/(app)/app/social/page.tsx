import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { readSocialQueue } from "../../../../lib/publishing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SocialQueuePage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
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

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Queue</p>
        <h2>Upcoming and published posts</h2>
        <div className="franchise-list">
          {result.queue.length === 0 ? (
            <div>
              <strong>No social posts queued</strong>
              <span>Approved social variants can be moved here from Content Studio.</span>
            </div>
          ) : (
            result.queue.map((item) => (
              <div key={item.publication.id}>
                <strong>{item.content?.title ?? "Untitled content"}</strong>
                <span>{item.publication.channel} - {item.publication.publishState} - {item.account?.displayName ?? "unknown account"}</span>
                <span>{item.publication.scheduledAt ?? "not scheduled"} - {item.publication.timezone}</span>
                <span>{item.warnings.length === 0 ? "No warnings" : item.warnings.join(", ")}</span>
              </div>
            ))
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

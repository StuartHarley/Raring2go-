import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../lib/app-shell";
import { listContentLibraryItems } from "../../../../lib/publishing-runtime";
import { AppShell } from "../../layout";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ContentLibraryPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await loadContent(request);

  if ("error" in result) {
    return protectedOutcome(result.error);
  }

  const needsAttention = result.items.filter((item) => item.health.length > 0).length;
  const sponsored = result.items.filter((item) => item.item.advertiserId || item.item.commercialBookingId).length;

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Content Studio</p>
        <h2>Canonical content library</h2>
        <p>
          Create once, localise, repurpose and review channel variants while
          keeping source provenance intact.
        </p>
        <div className="franchise-metrics">
          <article>
            <span>Items</span>
            <strong>{result.items.length}</strong>
          </article>
          <article>
            <span>Needs attention</span>
            <strong>{needsAttention}</strong>
          </article>
          <article>
            <span>Sponsored</span>
            <strong>{sponsored}</strong>
          </article>
          <article>
            <span>Localised</span>
            <strong>{result.items.filter((item) => item.localisations.length > 0).length}</strong>
          </article>
        </div>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Library</p>
        <h2>Reusable source content</h2>
        <div className="franchise-list">
          {result.items.map((item) => (
            <Link key={item.item.id} href={`/app/content/${item.item.id}` as Route}>
              <strong>{item.item.title}</strong>
              <span>{item.item.contentType} - {item.item.ownerLevel} - {item.item.status}</span>
              <span>{item.variants.length} channel variant(s) - edition {item.editionStatus.replace("_", " ")}</span>
              <span>{item.health.length === 0 ? "Healthy" : item.health.join(", ")}</span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function loadContent(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, {
      module: "content",
      action: "view"
    });
    const items = await listContentLibraryItems({
      userId: shell.userId,
      organisationId: shell.activeContext.organisationId,
      territoryId: shell.activeContext.territoryId
    });

    return { items };
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

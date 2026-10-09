import Link from "next/link";
import type { Route } from "next";
import { ShellAccessError, requireShellPermission } from "../../../../../lib/app-shell";
import { listAudienceImports } from "../../../../../lib/audience-import-runtime";
import { getDirectory } from "../../../../../lib/directory";
import { AppShell } from "../../../layout";
import { requestFromSearchParamsAndCookies } from "../../page";
import { ImportUploadForm } from "./ImportUploadForm";

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AudienceImportPage({ searchParams }: PageProps) {
  const request = await requestFromSearchParamsAndCookies(await searchParams);
  const result = await load(request);
  if ("error" in result) return protectedOutcome(result.error);

  const query = new URLSearchParams();
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  const queryString = query.size > 0 ? `?${query.toString()}` : "";

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Audience</p>
        <h2>Import contacts</h2>
        <p>
          Bring in an existing list safely. The file is checked first and nothing changes until you approve it. Only people with
          recorded consent are made subscribers; everyone else is added as &quot;not emailed&quot;. You can reverse an import afterwards.
        </p>
        <Link href={`/app/audience${queryString}` as Route} className="app-link-button">Back to audience</Link>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">New import</p>
        <h2>Check a file</h2>
        <ImportUploadForm territories={result.territories} defaultTerritoryId={request.territoryId} queryString={queryString} />
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">History</p>
        <h2>Previous imports</h2>
        {result.imports.length === 0 ? <p>No imports yet.</p> : null}
        <div className="franchise-list">
          {result.imports.map((record) => (
            <div key={record.id}>
              <strong>{record.source}</strong>
              <span>{record.status.replaceAll("_", " ")} - {record.totalRows} rows - {record.importedRows} added - {record.errorRows} rejected - {record.createdAt.toISOString().slice(0, 10)}</span>
              <Link href={`/app/audience/import/${record.id}${queryString}` as Route}>Open</Link>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

async function load(request: Awaited<ReturnType<typeof requestFromSearchParamsAndCookies>>) {
  try {
    const shell = await requireShellPermission(request, { module: "marketing.import", action: "manage" });
    const context = { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
    const directory = getDirectory();
    const all = await directory.listTerritories();
    const territories = context.territoryId ? all.filter((territory) => territory.id === context.territoryId) : all;
    return { imports: await listAudienceImports(context), territories };
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

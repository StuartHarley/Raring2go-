import Link from "next/link";
import { AppShell } from "../../layout";
import { resolveShell } from "../../../../lib/app-shell";
import { globalSearch } from "../../../../lib/global-search";
import { ProtectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const shell = await resolveShell(request);
  const query = first(params.q) ?? "";

  if (shell.kind !== "authenticated") {
    return <ProtectedOutcome outcome={shell} />;
  }

  const results = await globalSearch(shell, query);

  return (
    <AppShell request={request}>
      <section className="app-panel franchise-panel">
        <p className="eyebrow">Global search</p>
        <h2>Find operating records</h2>
        <form className="search-form">
          <input name="q" defaultValue={query} placeholder="Search franchisees, advertisers, editions or content" />
          {request.sessionKey ? <input type="hidden" name="session" value={request.sessionKey} /> : null}
          {request.organisationId ? <input type="hidden" name="organisationId" value={request.organisationId} /> : null}
          {request.territoryId ? <input type="hidden" name="territoryId" value={request.territoryId} /> : null}
          <button type="submit">Search</button>
        </form>
      </section>

      <section className="app-panel franchise-panel">
        <p className="eyebrow">Results</p>
        <h2>{query.trim().length < 2 ? "Enter at least two characters" : `${results.length} result${results.length === 1 ? "" : "s"}`}</h2>
        <div className="franchise-list">
          {results.map((result) => (
            <Link key={result.id} href={result.href}>
              <strong>{result.title}</strong>
              <span>{result.type} - {result.detail}</span>
            </Link>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

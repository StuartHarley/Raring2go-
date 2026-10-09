import { AppShell } from "../../layout";
import { resolveShell } from "../../../../lib/app-shell";
import { formatCount } from "../../../../lib/format";
import { globalSearch } from "../../../../lib/global-search";
import { EmptyState, PageHeader, Panel, RecordLink, RecordList } from "../../../../lib/page-ui";
import { ProtectedOutcome } from "../../../../lib/protected-outcome";
import { requestFromSearchParamsAndCookies } from "../page";

export const metadata = { title: "Search" };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const request = await requestFromSearchParamsAndCookies(params);
  const shell = await resolveShell(request);
  const query = first(params.q) ?? "";

  if (shell.kind !== "authenticated") {
    return <ProtectedOutcome outcome={shell} request={request} />;
  }

  const results = await globalSearch(shell, query);
  const tooShort = query.trim().length < 2;

  return (
    <AppShell request={request} shell={shell}>
      <PageHeader eyebrow="Search" title="Find a record" intro="Franchisees, advertisers, editions and content you are allowed to see. Press ⌘K anywhere to jump to a page." />

      <Panel>
        <form className="search-form" role="search">
          <input className="r2-input" name="q" defaultValue={query} aria-label="Search" placeholder="Search by name, title or area" autoFocus />
          {request.sessionKey ? <input type="hidden" name="session" value={request.sessionKey} /> : null}
          {request.organisationId ? <input type="hidden" name="organisationId" value={request.organisationId} /> : null}
          {request.territoryId ? <input type="hidden" name="territoryId" value={request.territoryId} /> : null}
          <button type="submit" className="r2-button r2-button--primary">
            Search
          </button>
        </form>
      </Panel>

      <Panel eyebrow="Results" title={tooShort ? "Type at least two characters" : formatCount(results.length, "result")}>
        {tooShort ? null : results.length === 0 ? (
          <EmptyState title={`Nothing matches "${query.trim()}"`}>Try a shorter word, or check the context you are working in.</EmptyState>
        ) : (
          <RecordList>
            {results.map((result) => (
              <RecordLink key={result.id} href={result.href} title={result.title} status={result.type} lines={[result.detail]} />
            ))}
          </RecordList>
        )}
      </Panel>
    </AppShell>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

import type { Route } from "next";
import type { ResolvedShell } from "./app-shell";
import { listAdvertiser360Rows, readPipeline } from "./advertising-runtime";
import { listComplianceOverview } from "./franchise-runtime";
import { listContentLibraryItems, listEditionFactoryRows } from "./publishing-runtime";

export type SearchResult = {
  id: string;
  type: "franchise" | "advertiser" | "opportunity" | "edition" | "content";
  title: string;
  detail: string;
  href: Route;
};

type SearchContext = {
  userId: string;
  organisationId: string;
  territoryId?: string;
};

export async function globalSearch(shell: ResolvedShell, query: string): Promise<SearchResult[]> {
  const normalisedQuery = query.trim().toLowerCase();
  if (normalisedQuery.length < 2) {
    return [];
  }

  const context: SearchContext = {
    userId: shell.userId,
    organisationId: shell.activeContext.organisationId,
    territoryId: shell.activeContext.territoryId
  };
  const visible = new Set(shell.navigation.map((item) => item.id));
  const results: SearchResult[] = [];

  if (visible.has("franchisees")) {
    const franchises = await listComplianceOverview(context).catch(() => []);
    for (const row of franchises) {
      addIfMatch(results, normalisedQuery, {
        id: `franchise-${row.franchise.id}`,
        type: "franchise",
        title: row.territory?.name ?? row.organisation?.name ?? row.franchise.id,
        detail: `Compliance ${row.completeCount}/${row.totalCount}; ${row.openActions} open action${row.openActions === 1 ? "" : "s"}`,
        href: `/app/franchisees/${row.franchise.id}` as Route
      });
    }
  }

  if (visible.has("advertisers")) {
    const advertisers = await listAdvertiser360Rows(context).catch(() => []);
    for (const row of advertisers) {
      addIfMatch(results, normalisedQuery, {
        id: `advertiser-${row.advertiser.id}`,
        type: "advertiser",
        title: row.organisation.name,
        detail: `${row.territory?.name ?? "Territory"}; ${row.advertiser.relationshipState}`,
        href: `/app/advertisers/${row.advertiser.id}` as Route
      });
    }

    const pipeline = await readPipeline(context).catch(() => undefined);
    for (const row of pipeline?.myPipeline ?? []) {
      addIfMatch(results, normalisedQuery, {
        id: `opportunity-${row.opportunity.id}`,
        type: "opportunity",
        title: row.opportunity.title,
        detail: `${row.organisation.name}; ${row.stage.name}`,
        href: "/app/advertisers/pipeline" as Route
      });
    }
  }

  if (visible.has("editions")) {
    const editions = await listEditionFactoryRows(context).catch(() => []);
    for (const row of editions) {
      addIfMatch(results, normalisedQuery, {
        id: `edition-${row.territoryEdition.id}`,
        type: "edition",
        title: row.territoryEdition.title,
        detail: `${row.territory?.name ?? "Territory"}; ${row.phase}; ${row.riskStatus.replace("_", " ")}`,
        href: `/app/editions/${row.territoryEdition.id}` as Route
      });
    }
  }

  if (visible.has("content")) {
    const content = await listContentLibraryItems(context).catch(() => []);
    for (const row of content) {
      addIfMatch(results, normalisedQuery, {
        id: `content-${row.item.id}`,
        type: "content",
        title: row.item.title,
        detail: `${row.item.contentType}; ${row.item.status}; ${row.health.join(", ") || "healthy"}`,
        href: `/app/content/${row.item.id}` as Route
      });
    }
  }

  return results.slice(0, 20);
}

function addIfMatch(results: SearchResult[], query: string, result: SearchResult) {
  const haystack = `${result.title} ${result.detail} ${result.type}`.toLowerCase();
  if (haystack.includes(query)) {
    results.push(result);
  }
}

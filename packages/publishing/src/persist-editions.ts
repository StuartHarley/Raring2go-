import {
  editionContentItems,
  editionPageRevisions,
  editionPages,
  magazineTemplateVersions,
  magazineTemplates,
  masterEditions,
  preflightResults,
  publicationOutputs,
  seasons,
  territoryEditionContent,
  territoryEditions
} from "@raring2go/db";
import { persistPlan, planCollectionChanges } from "./persist-social";
import type { CollectionList } from "./persist-social";
import type { PublishingData } from "./types";

/** Parents before children so inserts satisfy foreign keys. */
export const editionCollections: CollectionList = [
  ["seasons", seasons],
  ["masterEditions", masterEditions],
  ["magazineTemplates", magazineTemplates],
  ["magazineTemplateVersions", magazineTemplateVersions],
  ["editionContentItems", editionContentItems],
  ["territoryEditions", territoryEditions],
  ["territoryEditionContent", territoryEditionContent],
  ["editionPages", editionPages],
  ["editionPageRevisions", editionPageRevisions],
  ["preflightResults", preflightResults],
  ["publicationOutputs", publicationOutputs]
];

type WriteDb = Parameters<typeof persistPlan>[0];

/** Writes only what an Edition Factory domain function changed, inside the caller's transaction. */
export function planEditionChanges(before: PublishingData, after: PublishingData) {
  return planCollectionChanges(editionCollections, before, after, "Edition");
}

export async function persistEditionChanges(db: WriteDb, before: PublishingData, after: PublishingData, now: Date = new Date()) {
  return persistPlan(db, planEditionChanges(before, after), "Edition", now);
}

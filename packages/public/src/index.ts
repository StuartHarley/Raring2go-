import { loadAdvertisingData } from "@raring2go/advertising";
import { foundationSeed, publicHomepageTemplates } from "@raring2go/db";
import { HOMEPAGE_TEMPLATE_KEY, defaultHomepageSlots, usableHomepageSlots } from "./homepage-template";
import { loadMarketingData } from "@raring2go/marketing";
import { loadPublishingData } from "@raring2go/publishing";

type PublicDb = Parameters<typeof loadPublishingData>[0] &
  Parameters<typeof loadAdvertisingData>[0] &
  Parameters<typeof loadMarketingData>[0];

export type PublicTerritory = {
  id: string;
  slug: string;
  name: string;
  strapline: string;
  season: "spring" | "summer" | "autumn" | "winter";
};

export type PublicContentCard = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  type: string;
  source: "local" | "network";
  href: string;
  categories: string[];
  tags: string[];
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
};

export type PublicPlacement = {
  id: string;
  title: string;
  label: "Sponsored" | "Local business";
  summary: string;
  href: string;
  advertiserId?: string;
  tags?: string[];
};

export type PublicHomepageSlot = {
  id: string;
  kind:
    | "hero"
    | "stories"
    | "whats_on"
    | "things_to_do"
    | "magazine"
    | "offers"
    | "competitions"
    | "advertisers"
    | "newsletter"
    | "community";
  heading: string;
  visible: boolean;
  itemCount: number;
  source: "local_then_network" | "local_only" | "network";
  seasonalTreatment: boolean;
  commercialTreatment?: "sponsored" | "standard";
};

export type PublicHomepage = {
  territory: PublicTerritory;
  template: {
    key: string;
    version: number;
    slots: PublicHomepageSlot[];
    /** "published" when HQ has published a layout, "default" when the built-in one is in use. */
    origin: "published" | "default";
  };
  hero?: PublicContentCard;
  stories: PublicContentCard[];
  whatsOn: PublicContentCard[];
  thingsToDo: PublicContentCard[];
  offers: PublicContentCard[];
  competitions: PublicContentCard[];
  magazine?: {
    id: string;
    slug: string;
    title: string;
    status: string;
    issueDate?: string | null;
  };
  placements: PublicPlacement[];
  newsletter: {
    territoryId: string;
    heading: string;
    consentText: string;
  };
  emptyStates: Array<{ slot: string; message: string }>;
};

export type PublicDiscoveryKind = "whats_on" | "activities";

export type PublicDiscoveryFilters = {
  query?: string;
  category?: string;
  date?: "today" | "weekend" | "school_holidays" | "all";
};

export type PublicDiscoveryResult = {
  territory: PublicTerritory;
  kind: PublicDiscoveryKind;
  heading: string;
  filters: {
    query: string;
    category: string;
    date: NonNullable<PublicDiscoveryFilters["date"]>;
  };
  availableCategories: string[];
  items: PublicContentCard[];
  emptyState?: string;
};

export type PublicCommercialKind = "offers" | "competitions" | "businesses";

export type PublicCommercialResult = {
  territory: PublicTerritory;
  kind: PublicCommercialKind;
  heading: string;
  items: PublicContentCard[];
  placements: PublicPlacement[];
  labels: string[];
  emptyState?: string;
};

export type PublicMagazine = {
  territory: PublicTerritory;
  edition?: {
    id: string;
    slug: string;
    title: string;
    issueDate?: string | null;
    pageCount: number;
    outputVersion: number;
    artifact: Record<string, unknown>;
    pages: Array<{
      pageNumber: number;
      title: string;
      status: string;
      href: string;
    }>;
  };
  emptyState?: string;
};

export type PublicParentHub = {
  territory: PublicTerritory;
  authenticated: boolean;
  contact?: {
    id: string;
    email: string;
    name: string;
  };
  followedTerritories: Array<{ id: string; slug: string; name: string }>;
  savedContent: Array<{
    contentId?: string | null;
    id: string;
    title: string;
    contentType: string;
    savedAt: string;
    href: string;
  }>;
  preferences?: {
    interests: string[];
    eventCategories: string[];
    offerPreferences: string[];
    competitionPreferences: string[];
    newsletterFrequency: string;
    personalisationEnabled: boolean;
  };
  emptyState?: string;
};

export type PublicRecommendation = PublicContentCard & {
  reasons: string[];
};

export type PublicRecommendations = {
  territory: PublicTerritory;
  personalised: boolean;
  recommendations: PublicRecommendation[];
  emptyState?: string;
};

export type PublicSeoRoute = {
  path: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
};

export type PublicAnalyticsEventType =
  | "territory_viewed"
  | "content_viewed"
  | "newsletter_signup_started"
  | "newsletter_signup_completed"
  | "content_saved"
  | "discovery_item_clicked"
  | "magazine_opened"
  | "magazine_page_interaction"
  | "commercial_placement_clicked"
  | "public_conversion";

export type PublicAnalyticsInput = {
  eventType: PublicAnalyticsEventType;
  territorySlug: string;
  path: string;
  entityType?: "content" | "advertiser" | "edition" | "newsletter";
  entityId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
};

export type PublicAnalyticsEvent = {
  eventType: PublicAnalyticsEventType;
  territoryId: string;
  territorySlug: string;
  path: string;
  entityType?: PublicAnalyticsInput["entityType"];
  entityId?: string;
  sessionId?: string;
  occurredAt: string;
  retainUntil: string;
  attribution: Record<string, unknown>;
  metadata: Record<string, unknown>;
  privacy: {
    rawIpStored: false;
    userAgentStored: false;
    providerNeutral: true;
  };
};

type PublicTerritoryRecord = {
  id: string;
  name: string;
  status?: string;
  deletedAt?: Date | null;
};

type PublicProjectionData = Awaited<ReturnType<typeof loadPublishingData>>;

export const publicHomepageTemplate: PublicHomepage["template"] = {
  key: HOMEPAGE_TEMPLATE_KEY,
  version: 1,
  slots: defaultHomepageSlots(),
  origin: "default"
};

/** The live layout: the highest published version HQ has made, or the built-in default when there is none (or the stored one is unusable). */
export async function loadActiveHomepageTemplate(db: PublicDb): Promise<PublicHomepage["template"]> {
  const rows = (await (db as unknown as { select(): { from(table: unknown): Promise<Array<Record<string, unknown>>> } }).select().from(publicHomepageTemplates))
    .filter((row) => row.key === HOMEPAGE_TEMPLATE_KEY && row.status === "published")
    .sort((a, b) => Number(b.version) - Number(a.version));
  const live = rows[0];
  if (!live) return publicHomepageTemplate;
  const usable = usableHomepageSlots(live.slots);
  if (!usable.fromStored) {
    console.error("The published homepage layout is not valid; using the default", { version: live.version });
    return publicHomepageTemplate;
  }
  return { key: HOMEPAGE_TEMPLATE_KEY, version: Number(live.version), slots: usable.slots, origin: "published" };
}

export const websitePublishingDecision = {
  canonicalPublicExperience: "nextjs",
  legacyCmsBridge: "not_configured",
  contentOwnership: "raring2go_platform",
  publicRenderingBoundary: "@raring2go/public",
  bridgePolicy:
    "Do not fork public content into a parallel CMS. Transitional exports must be provider-neutral projections from approved platform records."
} as const;

export function publicSeoRoutes(baseUrl = "http://localhost:3000"): PublicSeoRoute[] {
  return publicSeoRoutesFromTerritories(foundationSeed.territories, baseUrl);
}

export async function publicSeoRoutesForDb(db: PublicDb, baseUrl = "http://localhost:3000"): Promise<PublicSeoRoute[]> {
  const [publishing, advertising] = await Promise.all([loadPublishingData(db), loadAdvertisingData(db)]);
  const sections = publicSeoRoutesFromTerritories(publishing.territories, baseUrl);
  // Detail pages are listed only when the record is public today, so the sitemap never
  // advertises a draft, expired or other-territory page.
  const details = publishing.territories.filter(isPublicTerritoryRecord).flatMap((record) => {
    const territory = publicTerritoryFromRecord(record, territorySlug(record.name));
    if (!territory) return [];
    const content = publicContentProjections(publishing, territory).map((item) => seoRoute(baseUrl, item.href, "weekly", 0.5));
    const editions = publishedMagazines(publishing, territory).map((magazine) =>
      seoRoute(baseUrl, `/areas/${territory.slug}/magazine/${territorySlug(magazine.edition.title)}`, "monthly", 0.6)
    );
    const businesses = publicAdvertiserPlacements(advertising, publishing, territory).map((placement) => seoRoute(baseUrl, placement.href, "monthly", 0.4));
    return [...content, ...editions, ...businesses];
  });
  return [...sections, ...details];
}

function publicSeoRoutesFromTerritories(territories: ReadonlyArray<PublicTerritoryRecord>, baseUrl: string): PublicSeoRoute[] {
  return territories.filter(isPublicTerritoryRecord).flatMap((territory) => {
    const slug = territorySlug(territory.name);
    return [
      seoRoute(baseUrl, `/areas/${slug}`, "daily", 0.9),
      seoRoute(baseUrl, `/areas/${slug}/whats-on`, "daily", 0.8),
      seoRoute(baseUrl, `/areas/${slug}/activities`, "weekly", 0.7),
      seoRoute(baseUrl, `/areas/${slug}/offers`, "weekly", 0.6),
      seoRoute(baseUrl, `/areas/${slug}/competitions`, "weekly", 0.6),
      seoRoute(baseUrl, `/areas/${slug}/businesses`, "monthly", 0.5),
      seoRoute(baseUrl, `/areas/${slug}/magazine`, "weekly", 0.7)
    ];
  });
}

export function publicTerritoryStructuredData(homepage: PublicHomepage, baseUrl = "http://localhost:3000") {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: `Raring2go! ${homepage.territory.name}`,
    url: `${baseUrl}/areas/${homepage.territory.slug}`,
    description: homepage.territory.strapline,
    areaServed: homepage.territory.name,
    sameAs: [],
    potentialAction: {
      "@type": "SearchAction",
      target: `${baseUrl}/areas/${homepage.territory.slug}/whats-on?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };
}

export function createPublicAnalyticsEvent(input: PublicAnalyticsInput, occurredAt = new Date()): PublicAnalyticsEvent {
  const territory = territoryFromSlug(input.territorySlug);
  return createPublicAnalyticsEventForTerritory(input, territory, occurredAt);
}

export async function createPublicAnalyticsEventForDb(
  db: PublicDb,
  input: PublicAnalyticsInput,
  occurredAt = new Date()
): Promise<PublicAnalyticsEvent> {
  const territory = await territoryFromSlugForDb(db, input.territorySlug);
  return createPublicAnalyticsEventForTerritory(input, territory, occurredAt);
}

/** For events the server itself observes (a save, a confirmed subscription), where the territory is known by id, not slug. */
export async function createPublicAnalyticsEventForTerritoryId(
  db: PublicDb,
  territoryId: string,
  input: Omit<PublicAnalyticsInput, "territorySlug">,
  occurredAt = new Date()
): Promise<PublicAnalyticsEvent> {
  const publishing = await loadPublishingData(db);
  const record = publishing.territories.find((candidate) => candidate.id === territoryId);
  const territory = record ? publicTerritoryFromRecord(record, territorySlug(record.name)) : undefined;
  // A path may say {slug}, so a caller that only knows the territory id still records a real page path.
  return createPublicAnalyticsEventForTerritory({ ...input, path: input.path.replace("{slug}", territory?.slug ?? ""), territorySlug: territory?.slug ?? "" }, territory, occurredAt);
}

/** Events only the server may record: a client cannot claim someone saved something or confirmed a subscription. */
export const serverOnlyAnalyticsEventTypes: PublicAnalyticsEventType[] = ["content_saved", "newsletter_signup_completed"];

function createPublicAnalyticsEventForTerritory(
  input: PublicAnalyticsInput,
  territory: PublicTerritory | undefined,
  occurredAt: Date
): PublicAnalyticsEvent {
  if (!territory) {
    throw new Error("Unknown public territory.");
  }
  if (!input.path.startsWith("/") || input.path.startsWith("//") || input.path.includes("://")) {
    throw new Error("Public analytics path must be a safe internal path.");
  }

  return {
    eventType: input.eventType,
    territoryId: territory.id,
    territorySlug: territory.slug,
    path: input.path,
    entityType: input.entityType,
    entityId: input.entityId,
    sessionId: input.sessionId,
    occurredAt: occurredAt.toISOString(),
    retainUntil: analyticsRetainUntil(occurredAt).toISOString(),
    attribution: analyticsAttribution(input.metadata ?? {}),
    metadata: publicAnalyticsMetadata(input.metadata ?? {}),
    privacy: {
      rawIpStored: false,
      userAgentStored: false,
      providerNeutral: true
    }
  };
}

function analyticsRetainUntil(occurredAt: Date) {
  const retainUntil = new Date(occurredAt);
  retainUntil.setUTCMonth(retainUntil.getUTCMonth() + 18);
  return retainUntil;
}

export function territorySlug(name: string) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function territoryFromSlug(slug: string): PublicTerritory | undefined {
  return publicTerritoryFromRecord(foundationSeed.territories.find((candidate) => territorySlug(candidate.name) === slug), slug);
}

export async function territoryFromSlugForDb(db: PublicDb, slug: string): Promise<PublicTerritory | undefined> {
  const publishing = await loadPublishingData(db);
  return publicTerritoryFromRecord(publishing.territories.find((candidate) => territorySlug(candidate.name) === slug), slug);
}

export async function resolvePublicTerritory(db: PublicDb, slug: string): Promise<PublicTerritory | undefined> {
  return territoryFromSlugForDb(db, slug);
}

function publicTerritoryFromRecord(territory: PublicTerritoryRecord | undefined, slug: string): PublicTerritory | undefined {
  if (!territory || !isPublicTerritoryRecord(territory)) {
    return undefined;
  }

  return {
    id: territory.id,
    slug,
    name: territory.name,
    strapline: `Activities, events, offers and family inspiration around ${territory.name}.`,
    season: "autumn"
  };
}

function isPublicTerritoryRecord(territory: PublicTerritoryRecord) {
  return !territory.deletedAt && (territory.status === undefined || territory.status === "active");
}

export function projectPublicContent(
  data: PublicProjectionData,
  item: PublicProjectionData["contentItems"][number],
  territory: PublicTerritory,
  now = new Date()
): PublicContentCard | undefined {
  if (!isPublishableContentItem(item, territory, now)) {
    return undefined;
  }

  const localisation = data.contentLocalisations.find((candidate) =>
    !candidate.deletedAt &&
    candidate.masterContentItemId === item.id &&
    candidate.territoryId === territory.id
  );
  if (localisation) {
    if (["opted_out", "review_required", "master_updated"].includes(localisation.state)) {
      return undefined;
    }
    if (localisation.localContentItemId) {
      const localItem = data.contentItems.find((candidate) => candidate.id === localisation.localContentItemId);
      if (!localItem || !isPublishableContentItem(localItem, territory, now)) {
        return undefined;
      }
      return contentCard(localItem, territory);
    }
  }

  const variant = data.contentChannelVariants.find((candidate) =>
    !candidate.deletedAt &&
    candidate.contentItemId === item.id &&
    candidate.channel === "website" &&
    ["approved", "published"].includes(candidate.status) &&
    (!candidate.territoryId || candidate.territoryId === territory.id)
  );
  if (!variant?.currentVersionId) {
    return undefined;
  }
  const version = data.contentChannelVariantVersions.find((candidate) =>
    !candidate.deletedAt &&
    candidate.id === variant.currentVersionId &&
    candidate.variantId === variant.id &&
    ["approved", "published"].includes(candidate.status)
  );
  if (!version) {
    return undefined;
  }

  return contentCard(item, territory);
}

function publicContentProjections(data: PublicProjectionData, territory: PublicTerritory, now = new Date()) {
  const cards = data.contentItems
    .map((item) => projectPublicContent(data, item, territory, now))
    .filter((item): item is PublicContentCard => Boolean(item));
  return uniqueSlugs(cards, territory);
}

/**
 * Titles are not unique, but an address must be. Within a section the lowest id keeps the plain
 * slug and any other item sharing it gets its own id fragment, so each public page has exactly one
 * address and every card links to the page it describes.
 */
function uniqueSlugs(cards: PublicContentCard[], territory: PublicTerritory) {
  const claimed = new Set<string>();
  const slugById = new Map<string, string>();
  for (const card of [...cards].sort((left, right) => left.id.localeCompare(right.id))) {
    const section = contentSection(card.type);
    let slug = card.slug;
    if (claimed.has(`${section}/${slug}`)) slug = `${card.slug}-${card.id.replaceAll("-", "").slice(0, 8)}`;
    claimed.add(`${section}/${slug}`);
    slugById.set(card.id, slug);
  }
  // Keep the original order; only the address of a colliding item changes.
  return cards.map((card) => {
    const slug = slugById.get(card.id)!;
    return slug === card.slug ? card : { ...card, slug, href: `/areas/${territory.slug}/${contentSection(card.type)}/${slug}` };
  });
}

function isPublishableContentItem(
  item: PublicProjectionData["contentItems"][number],
  territory: PublicTerritory,
  now: Date
) {
  if (item.deletedAt || !["approved", "published"].includes(item.status)) {
    return false;
  }
  if (!(item.territoryId === territory.id || item.ownerLevel === "network")) {
    return false;
  }
  if (item.ownerLevel !== "network" && !item.territoryId) {
    return false;
  }
  return isWithinPublicDateWindow(item.relevantDates ?? {}, now);
}

function isWithinPublicDateWindow(relevantDates: Record<string, unknown>, now: Date) {
  const availableFrom = stringValue(relevantDates.availableFrom) ?? stringValue(relevantDates.publishFrom);
  const expiresAt = stringValue(relevantDates.expiresAt) ?? stringValue(relevantDates.endDate);
  if (availableFrom && new Date(availableFrom) > now) {
    return false;
  }
  if (expiresAt && new Date(expiresAt) < now) {
    return false;
  }
  return true;
}

function latestPublishedMagazine(publishing: PublicProjectionData, territory: PublicTerritory) {
  return publishedMagazines(publishing, territory)[0];
}

function publishedMagazines(publishing: PublicProjectionData, territory: PublicTerritory) {
  return publishing.publicationOutputs
    .filter((output) => !output.deletedAt)
    .filter((output) => output.outputType === "digital" && output.status === "generated")
    .map((output) => {
      const edition = publishing.territoryEditions.find((candidate) =>
        !candidate.deletedAt &&
        candidate.id === output.territoryEditionId &&
        candidate.territoryId === territory.id &&
        candidate.status === "published" &&
        candidate.digitalStatus === "generated"
      );
      return edition ? { edition, output } : null;
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .sort((left, right) => {
      const dateCompare = (right.edition.publicationDate ?? "").localeCompare(left.edition.publicationDate ?? "");
      return dateCompare === 0 ? right.output.version - left.output.version : dateCompare;
    });
}

function publishedMagazinePages(
  publishing: PublicProjectionData,
  magazine: NonNullable<ReturnType<typeof latestPublishedMagazine>>,
  territory: PublicTerritory
) {
  const snapshot = Array.isArray(magazine.output.sourcePageSnapshot)
    ? magazine.output.sourcePageSnapshot
    : [];
  return snapshot
    .map((entry) => {
      const pageId = typeof entry === "object" && entry ? stringValue((entry as Record<string, unknown>).id) : null;
      return pageId
        ? publishing.editionPages.find((candidate) =>
          !candidate.deletedAt &&
          candidate.id === pageId &&
          candidate.territoryEditionId === magazine.edition.id &&
          candidate.status === "published"
        )
        : undefined;
    })
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => ({
      pageNumber: page.pageNumber,
      title: page.assignedContentId
        ? publishing.contentItems.find((item) => item.id === page.assignedContentId)?.title ?? `Page ${page.pageNumber}`
        : `Page ${page.pageNumber}`,
      status: page.status,
      href: `/areas/${territory.slug}/magazine/${territorySlug(magazine.edition.title)}/pages/${page.pageNumber}`
    }));
}

function publicAdvertiserPlacements(
  advertising: Awaited<ReturnType<typeof loadAdvertisingData>>,
  publishing: PublicProjectionData,
  territory: PublicTerritory
) {
  const validAdvertiserIds = new Set(advertising.campaignFulfilments
    .filter((fulfilment) => !fulfilment.deletedAt)
    .filter((fulfilment) => fulfilment.territoryId === territory.id && fulfilment.status === "fulfilled")
    .filter((fulfilment) => Boolean(fulfilment.territoryEditionId && fulfilment.editionPageId))
    .filter((fulfilment) => {
      const edition = publishing.territoryEditions.find((candidate) =>
        candidate.id === fulfilment.territoryEditionId &&
        candidate.territoryId === territory.id &&
        candidate.status === "published" &&
        candidate.digitalStatus === "generated" &&
        !candidate.deletedAt
      );
      const output = publishing.publicationOutputs.find((candidate) =>
        candidate.territoryEditionId === fulfilment.territoryEditionId &&
        candidate.outputType === "digital" &&
        candidate.status === "generated" &&
        !candidate.deletedAt
      );
      const page = publishing.editionPages.find((candidate) =>
        candidate.id === fulfilment.editionPageId &&
        candidate.territoryEditionId === fulfilment.territoryEditionId &&
        candidate.status === "published" &&
        !candidate.deletedAt
      );
      return Boolean(edition && output && page);
    })
    .map((fulfilment) => fulfilment.advertiserId));

  return advertising.advertisers
    .filter((advertiser) => !advertiser.deletedAt)
    .filter((advertiser) => advertiser.status === "active")
    .filter((advertiser) => advertiser.owningTerritoryId === territory.id)
    .filter((advertiser) => validAdvertiserIds.has(advertiser.id))
    .map((advertiser) => {
      const organisation = advertising.organisations.find((candidate) => candidate.id === advertiser.advertiserOrganisationId);
      return {
        id: advertiser.id,
        advertiserId: advertiser.id,
        title: organisation?.name ?? "Local advertiser",
        label: advertiser.commercialMetadata.publicPlacement === "sponsored" ? "Sponsored" as const : "Local business" as const,
        summary: stringValue(advertiser.commercialMetadata.publicSummary) ?? "Local family-friendly business.",
        href: `/areas/${territory.slug}/businesses/${advertiser.id}`,
        tags: advertiser.tags
      };
    });
}

export function assertPublicNewsletterSocialLinkage(
  data: PublicProjectionData,
  territory: PublicTerritory
) {
  const publicContentIds = new Set(publicContentProjections(data, territory).map((item) => item.id));
  const socialLinked = data.socialPublications
    .filter((publication) => !publication.deletedAt && publication.territoryId === territory.id && publication.publishState === "published")
    .every((publication) =>
      Boolean(publication.contentItemId && publicContentIds.has(publication.contentItemId) && publication.variantId && publication.variantVersionId)
    );
  return socialLinked;
}

/** Items for a section, honouring where HQ says they come from: local first then network, local only, or network only. */
function pickBySource(items: PublicContentCard[], source: PublicHomepageSlot["source"], count: number) {
  const local = items.filter((item) => item.source === "local");
  const network = items.filter((item) => item.source === "network");
  const ordered = source === "local_only" ? local : source === "network" ? network : [...local, ...network];
  return ordered.slice(0, count);
}

export async function getPublicHomepage(db: PublicDb, slug: string): Promise<PublicHomepage | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const [publishing, advertising, template] = await Promise.all([
    loadPublishingData(db),
    loadAdvertisingData(db),
    loadActiveHomepageTemplate(db)
  ]);
  const slotOf = (kind: PublicHomepageSlot["kind"]) => template.slots.find((candidate) => candidate.kind === kind);
  const shown = (kind: PublicHomepageSlot["kind"]) => {
    const found = slotOf(kind);
    return found && found.visible ? found : undefined;
  };
  const approvedContent = publicContentProjections(publishing, territory);
  const forSlot = (kind: PublicHomepageSlot["kind"], items: PublicContentCard[]) => {
    const found = shown(kind);
    return found ? pickBySource(items, found.source, found.itemCount) : [];
  };
  const stories = forSlot("stories", approvedContent);
  // The hero is the lead story from where HQ says the hero draws from, even if the stories section is hidden.
  const heroSlot = shown("hero");
  const hero = heroSlot ? pickBySource(approvedContent, heroSlot.source, 1)[0] : undefined;
  const magazine = shown("magazine") ? latestPublishedMagazine(publishing, territory) : undefined;
  const advertisersSlot = shown("advertisers");
  const placements = advertisersSlot ? publicAdvertiserPlacements(advertising, publishing, territory).slice(0, advertisersSlot.itemCount) : [];
  const offers = forSlot("offers", approvedContent.filter((item) => item.type === "offer" || item.type === "advertiser_sponsored"));
  const competitions = forSlot("competitions", approvedContent.filter((item) => item.type === "competition"));
  const emptyStates: PublicHomepage["emptyStates"] = [];
  const empty = (kind: PublicHomepageSlot["kind"], message: string) => emptyStates.push({ slot: kind, message });

  if (shown("stories") && stories.length === 0) empty("stories", "Approved local stories will appear here once they are published.");
  if (advertisersSlot && placements.length === 0) empty("advertisers", "Local business placements will appear here when booked and approved.");
  if (shown("offers") && offers.length === 0) empty("offers", "Approved offers will appear here once they are published.");
  if (shown("competitions") && competitions.length === 0) empty("competitions", "Approved competitions will appear here once they are published.");

  return {
    territory,
    template,
    hero,
    stories,
    whatsOn: forSlot("whats_on", approvedContent.filter((item) => item.type === "event")),
    thingsToDo: forSlot("things_to_do", approvedContent.filter((item) => ["article", "guide"].includes(item.type))),
    offers,
    competitions,
    magazine: magazine
      ? {
          id: magazine.edition.id,
          slug: territorySlug(magazine.edition.title),
          title: magazine.edition.title,
          status: magazine.edition.status,
          issueDate: magazine.edition.publicationDate
        }
      : undefined,
    placements,
    newsletter: {
      territoryId: territory.id,
      heading: `Get ${territory.name} family ideas in your inbox`,
      consentText: "Subscribe to Raring2go updates for this area. Consent is recorded in the native audience model."
    },
    emptyStates
  };
}

export async function getPublicDiscovery(
  db: PublicDb,
  slug: string,
  kind: PublicDiscoveryKind,
  filters: PublicDiscoveryFilters = {}
): Promise<PublicDiscoveryResult | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const publishing = await loadPublishingData(db);
  const query = (filters.query ?? "").trim().toLowerCase();
  const category = (filters.category ?? "all").trim().toLowerCase();
  const date = filters.date ?? "all";
  const contentTypes = kind === "whats_on" ? new Set(["event"]) : new Set(["article", "guide", "evergreen"]);
  const publicItems = publicContentProjections(publishing, territory)
    .filter((item) => contentTypes.has(item.type))
    .filter((item) => matchesQuery(item, query))
    .filter((item) => matchesCategory(item, category))
    .filter((item) => matchesDate(item, date))
    .sort((left, right) => (left.startDate ?? "9999-12-31").localeCompare(right.startDate ?? "9999-12-31"));
  const categories = Array.from(
    new Set(
      publicContentProjections(publishing, territory)
        .filter((item) => contentTypes.has(item.type))
        .flatMap((item) => item.categories)
        .map((value) => value.toLowerCase())
    )
  ).sort();

  return {
    territory,
    kind,
    heading: kind === "whats_on" ? "What's on near you" : "Activities and things to do",
    filters: {
      query,
      category,
      date
    },
    availableCategories: categories,
    items: publicItems,
    emptyState: publicItems.length === 0
      ? "Nothing public matches those filters yet. Approved local discovery content will appear here when it is ready."
      : undefined
  };
}

export async function getPublicCommercialDiscovery(
  db: PublicDb,
  slug: string,
  kind: PublicCommercialKind
): Promise<PublicCommercialResult | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const [publishing, advertising] = await Promise.all([
    loadPublishingData(db),
    loadAdvertisingData(db)
  ]);
  const contentTypes = kind === "offers"
    ? new Set(["offer", "advertiser_sponsored"])
    : kind === "competitions"
      ? new Set(["competition"])
      : new Set<string>();
  const items = kind === "businesses"
    ? []
    : publicContentProjections(publishing, territory)
      .filter((item) => contentTypes.has(item.type));
  const placements = publicAdvertiserPlacements(advertising, publishing, territory);
  const visiblePlacements = kind === "businesses"
    ? placements
    : placements.filter((placement) => placement.label === "Sponsored").slice(0, 4);
  const labels = Array.from(new Set([...visiblePlacements.map((placement) => placement.label), ...items.map(() => "Sponsored")]));

  return {
    territory,
    kind,
    heading: commercialHeading(kind),
    items,
    placements: visiblePlacements,
    labels,
    emptyState: items.length === 0 && visiblePlacements.length === 0
      ? "Commercial discovery will appear here when approved offers, competitions or advertiser placements are available."
      : undefined
  };
}

export async function getPublicMagazine(db: PublicDb, slug: string): Promise<PublicMagazine | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const publishing = await loadPublishingData(db);
  const magazine = latestPublishedMagazine(publishing, territory);
  if (!magazine) {
    return {
      territory,
      emptyState: "The digital magazine for this area is not public yet. Published generated outputs will appear here."
    };
  }

  return {
    territory,
    edition: {
      id: magazine.edition.id,
      slug: territorySlug(magazine.edition.title),
      title: magazine.edition.title,
      issueDate: magazine.edition.publicationDate,
      pageCount: magazine.edition.pageCount,
      outputVersion: magazine.output.version,
      artifact: magazine.output.artifact,
      pages: publishedMagazinePages(publishing, magazine, territory)
    }
  };
}

export async function getPublicParentHub(
  db: PublicDb,
  slug: string,
  contactId?: string | null
): Promise<PublicParentHub | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  if (!contactId) {
    return {
      territory,
      authenticated: false,
      followedTerritories: [],
      savedContent: [],
      emptyState: "Sign in to see saved articles, followed areas and local preferences."
    };
  }

  const [marketing, publishing] = await Promise.all([
    loadMarketingData(db),
    loadPublishingData(db)
  ]);
  const contact = marketing.contacts.find((candidate) => candidate.id === contactId && !candidate.deletedAt);
  if (!contact) {
    return {
      territory,
      authenticated: false,
      followedTerritories: [],
      savedContent: [],
      emptyState: "Sign in to see saved articles, followed areas and local preferences."
    };
  }

  const profile = marketing.preferenceProfiles.find((candidate) => candidate.contactId === contact.id && !candidate.deletedAt);
  const followedIds = new Set([
    ...(profile?.followedTerritoryIds ?? []),
    ...marketing.subscriptions
      .filter((subscription) => subscription.contactId === contact.id && subscription.status === "subscribed" && !subscription.deletedAt)
      .map((subscription) => subscription.territoryId)
  ]);
  const followedTerritories = publishing.territories
    .filter((candidate) => followedIds.has(candidate.id))
    .filter(isPublicTerritoryRecord)
    .map((candidate) => ({
      id: candidate.id,
      slug: territorySlug(candidate.name),
      name: candidate.name
    }));
  const publishableSavedContent = new Map(
    publicContentProjections(publishing, territory)
      .map((item) => [item.id, item])
  );
  const savedContent = marketing.savedContent
    .filter((saved) => saved.contactId === contact.id && !saved.deletedAt)
    .filter((saved) => !saved.territoryId || saved.territoryId === territory.id || followedIds.has(saved.territoryId))
    .filter((saved) => !saved.contentReferenceId || publishableSavedContent.has(saved.contentReferenceId))
    .map((saved) => ({
      id: saved.id,
      contentId: saved.contentReferenceId ?? null,
      title: saved.contentReferenceId ? publishableSavedContent.get(saved.contentReferenceId)?.title ?? saved.title : saved.title,
      contentType: saved.contentReferenceId ? publishableSavedContent.get(saved.contentReferenceId)?.type ?? saved.contentType : saved.contentType,
      savedAt: saved.savedAt,
      href: saved.contentReferenceId
        ? publishableSavedContent.get(saved.contentReferenceId)?.href ?? `/areas/${territory.slug}`
        : `/areas/${territory.slug}/${contentSection(saved.contentType)}/${territorySlug(saved.title)}`
    }));

  return {
    territory,
    authenticated: true,
    contact: {
      id: contact.id,
      email: contact.email,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.email
    },
    followedTerritories,
    savedContent,
    preferences: profile
      ? {
          interests: profile.interests,
          eventCategories: profile.eventCategories,
          offerPreferences: profile.offerPreferences,
          competitionPreferences: profile.competitionPreferences,
          newsletterFrequency: profile.newsletterFrequency,
          personalisationEnabled: profile.personalisationEnabled
        }
      : undefined,
    emptyState: savedContent.length === 0 ? "Saved content will appear here when this parent saves public articles, events or offers." : undefined
  };
}

export async function getPublicRecommendations(
  db: PublicDb,
  slug: string,
  contactId?: string | null
): Promise<PublicRecommendations | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const [publishing, marketing] = await Promise.all([
    loadPublishingData(db),
    contactId ? loadMarketingData(db) : Promise.resolve(undefined)
  ]);
  const storedProfile = contactId
    ? marketing?.preferenceProfiles.find((candidate) => candidate.contactId === contactId && !candidate.deletedAt)
    : undefined;
  // A parent who turned personalisation off is treated exactly like an anonymous visitor.
  const profile = storedProfile?.personalisationEnabled ? storedProfile : undefined;
  const preferenceTerms = new Set([
    ...(profile?.interests ?? []),
    ...(profile?.eventCategories ?? []),
    ...(profile?.offerPreferences ?? []),
    ...(profile?.competitionPreferences ?? [])
  ].map((value) => value.toLowerCase()));
  const items = publicContentProjections(publishing, territory)
    .map((item) => {
      return {
        ...item,
        reasons: recommendationReasons(item, preferenceTerms, territory)
      };
    })
    .filter((item) => item.reasons.length > 0 || !profile)
    .sort((left, right) => right.reasons.length - left.reasons.length)
    .slice(0, 8);

  return {
    territory,
    personalised: Boolean(profile?.personalisationEnabled),
    recommendations: items.map((item) => ({
      ...item,
      reasons: item.reasons.length > 0 ? item.reasons : ["Popular local Raring2go content"]
    })),
    emptyState: items.length === 0 ? "Recommendations will appear here when public local content matches your preferences." : undefined
  };
}

function slot(
  kind: PublicHomepageSlot["kind"],
  heading: string,
  itemCount: number,
  commercialTreatment?: PublicHomepageSlot["commercialTreatment"]
): PublicHomepageSlot {
  return {
    id: `slot_${kind}`,
    kind,
    heading,
    visible: true,
    itemCount,
    source: kind === "newsletter" ? "local_only" : "local_then_network",
    seasonalTreatment: ["hero", "magazine", "newsletter"].includes(kind),
    commercialTreatment
  };
}

function seoRoute(
  baseUrl: string,
  path: string,
  changeFrequency: PublicSeoRoute["changeFrequency"],
  priority: number
): PublicSeoRoute {
  return {
    path: `${baseUrl.replace(/\/$/, "")}${path}`,
    changeFrequency,
    priority
  };
}

function contentCard(
  item: {
    id: string;
    title: string;
    standfirst?: string | null;
    contentType: string;
    territoryId?: string | null;
    ownerLevel: string;
    categories?: string[];
    tags?: string[];
    relevantDates?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  },
  territory: PublicTerritory
): PublicContentCard {
  const relevantDates = item.relevantDates ?? {};
  const provenance = item.provenance ?? {};
  return {
    id: item.id,
    slug: territorySlug(item.title),
    title: item.title,
    summary: item.standfirst ?? "Family inspiration from Raring2go.",
    type: item.contentType,
    source: item.territoryId === territory.id ? "local" : "network",
    href: `/areas/${territory.slug}/${contentSection(item.contentType)}/${territorySlug(item.title)}`,
    categories: item.categories ?? [],
    tags: item.tags ?? [],
    startDate: stringValue(relevantDates.startDate) ?? stringValue(relevantDates.date),
    endDate: stringValue(relevantDates.endDate),
    location: stringValue(provenance.location) ?? stringValue(provenance.venue)
  };
}

export type PublicContentSection = "whats-on" | "activities" | "offers" | "competitions";

/** Which public section a content type belongs to; also decides its detail URL. */
export function contentSection(contentType: string): PublicContentSection {
  if (contentType === "event") return "whats-on";
  if (contentType === "offer" || contentType === "advertiser_sponsored") return "offers";
  if (contentType === "competition") return "competitions";
  return "activities";
}

function matchesQuery(item: PublicContentCard, query: string) {
  if (!query) return true;
  return [item.title, item.summary, item.location, ...item.categories, ...item.tags]
    .filter((value): value is string => typeof value === "string")
    .some((value) => value.toLowerCase().includes(query));
}

function matchesCategory(item: PublicContentCard, category: string) {
  return category === "all" || item.categories.map((value) => value.toLowerCase()).includes(category);
}

function matchesDate(item: PublicContentCard, date: NonNullable<PublicDiscoveryFilters["date"]>) {
  if (date === "all") return true;
  if (!item.startDate) return date === "school_holidays" && item.tags.includes("school-holidays");
  const start = new Date(item.startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date === "today") return sameDay(start, today);
  if (date === "weekend") return start.getDay() === 0 || start.getDay() === 6;
  return item.tags.includes("school-holidays") || item.categories.includes("school-holidays");
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function commercialHeading(kind: PublicCommercialKind) {
  if (kind === "offers") return "Offers families will love";
  if (kind === "competitions") return "Competitions";
  return "Local family-friendly businesses";
}

function recommendationReasons(card: PublicContentCard, preferenceTerms: Set<string>, territory: PublicTerritory) {
  const reasons: string[] = [];
  const matches = [...card.categories, ...card.tags].filter((value) => preferenceTerms.has(value.toLowerCase()));
  if (matches.length > 0) {
    reasons.push(`Matches ${matches.slice(0, 2).join(", ")}`);
  }
  if (card.source === "local") {
    reasons.push(`Local to ${territory.name}`);
  }
  if (card.type === "event") {
    reasons.push("Upcoming family event");
  }
  return reasons;
}

function publicAnalyticsMetadata(metadata: Record<string, unknown>) {
  const allowed = new Set([
    "source",
    "channel",
    "campaign",
    "component",
    "position",
    "interaction",
    "conversionType",
    "utmSource",
    "utmMedium",
    "utmCampaign"
  ]);
  return redactAnalyticsMetadata(
    Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.has(key)))
  );
}

function analyticsAttribution(metadata: Record<string, unknown>) {
  const allowed = new Set(["source", "channel", "campaign", "utmSource", "utmMedium", "utmCampaign"]);
  return redactAnalyticsMetadata(
    Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.has(key)))
  );
}

function redactAnalyticsMetadata(metadata: Record<string, unknown>) {
  const blocked = new Set(["email", "emailAddress", "ip", "ipAddress", "userAgent", "name", "phone"]);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.has(key)));
}

export const defaultPublicTerritorySlug = "sutton-coldfield";

/* ----- Detail pages (PUB-002/003/004/007) ----- */

export type PublicContentDetail = {
  territory: PublicTerritory;
  section: PublicContentSection;
  item: PublicContentCard;
  headline: string;
  seoTitle: string;
  body: string[];
  related: PublicContentCard[];
  /** Pages with no real body are kept out of search results rather than shown as thin content. */
  indexable: boolean;
  canonicalPath: string;
  structuredData?: Record<string, unknown>;
};

/**
 * One public content page. It exists only if the record is public today in this territory
 * (approved, in its date window, with an approved website version) and belongs to the section
 * in the URL, so a draft, expired, other-territory or wrong-section address is simply absent.
 */
export async function getPublicContentDetail(
  db: PublicDb,
  slug: string,
  section: PublicContentSection,
  itemSlug: string,
  baseUrl = "http://localhost:3000"
): Promise<PublicContentDetail | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) return undefined;

  const publishing = await loadPublishingData(db);
  const inSection = publicContentProjections(publishing, territory).filter((candidate) => contentSection(candidate.type) === section);
  // Titles can collide; the lowest id wins so the same address always shows the same page.
  const item = inSection.filter((candidate) => candidate.slug === itemSlug).sort((left, right) => left.id.localeCompare(right.id))[0];
  if (!item) return undefined;

  const snapshot = websiteSnapshot(publishing, item.id, territory);
  const body = snapshotParagraphs(snapshot.body);
  const headline = stringValue(snapshot.webHeadline) ?? item.title;
  const canonicalPath = item.href;

  return {
    territory,
    section,
    item,
    headline,
    seoTitle: stringValue(snapshot.seoTitle) ?? `${headline} | Raring2go! ${territory.name}`,
    body,
    related: inSection.filter((candidate) => candidate.id !== item.id).slice(0, 3),
    indexable: body.length > 0,
    canonicalPath,
    structuredData: contentStructuredData(item, headline, territory, `${baseUrl.replace(/\/$/, "")}${canonicalPath}`)
  };
}

function websiteSnapshot(publishing: PublicProjectionData, itemId: string, territory: PublicTerritory): Record<string, unknown> {
  const variant = publishing.contentChannelVariants.find((candidate) =>
    !candidate.deletedAt &&
    candidate.contentItemId === itemId &&
    candidate.channel === "website" &&
    ["approved", "published"].includes(candidate.status) &&
    (!candidate.territoryId || candidate.territoryId === territory.id)
  );
  const version = variant?.currentVersionId
    ? publishing.contentChannelVariantVersions.find((candidate) =>
        !candidate.deletedAt && candidate.id === variant.currentVersionId && ["approved", "published"].includes(candidate.status)
      )
    : undefined;
  return version?.snapshot ?? {};
}

/** Plain text only: the body is rendered as text, never as markup. */
function snapshotParagraphs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n{2,}/) : [];
  return raw
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function contentStructuredData(item: PublicContentCard, headline: string, territory: PublicTerritory, url: string) {
  if (item.type === "event" && item.startDate) {
    return {
      "@context": "https://schema.org",
      "@type": "Event",
      name: headline,
      description: item.summary,
      startDate: item.startDate,
      ...(item.endDate ? { endDate: item.endDate } : {}),
      ...(item.location ? { location: { "@type": "Place", name: item.location, address: territory.name } } : {}),
      url
    };
  }
  if (item.type === "article" || item.type === "guide") {
    return { "@context": "https://schema.org", "@type": "Article", headline, description: item.summary, url, publisher: { "@type": "Organization", name: "Raring2go!" } };
  }
  return undefined;
}

export type PublicMagazineEdition = NonNullable<PublicMagazine["edition"]>;

export type PublicMagazineEditionView = {
  territory: PublicTerritory;
  edition: PublicMagazineEdition;
  otherEditions: Array<{ slug: string; title: string; issueDate?: string | null }>;
};

function editionView(publishing: PublicProjectionData, territory: PublicTerritory, magazine: NonNullable<ReturnType<typeof latestPublishedMagazine>>): PublicMagazineEdition {
  return {
    id: magazine.edition.id,
    slug: territorySlug(magazine.edition.title),
    title: magazine.edition.title,
    issueDate: magazine.edition.publicationDate,
    pageCount: magazine.edition.pageCount,
    outputVersion: magazine.output.version,
    artifact: magazine.output.artifact,
    pages: publishedMagazinePages(publishing, magazine, territory)
  };
}

/** A published edition by its address. Unpublished or ungenerated editions are absent. */
export async function getPublicMagazineEdition(db: PublicDb, slug: string, editionSlug: string): Promise<PublicMagazineEditionView | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) return undefined;
  const publishing = await loadPublishingData(db);
  const all = publishedMagazines(publishing, territory);
  const match = all.find((magazine) => territorySlug(magazine.edition.title) === editionSlug);
  if (!match) return undefined;

  return {
    territory,
    edition: editionView(publishing, territory, match),
    otherEditions: all
      .filter((magazine) => magazine.edition.id !== match.edition.id)
      .map((magazine) => ({ slug: territorySlug(magazine.edition.title), title: magazine.edition.title, issueDate: magazine.edition.publicationDate }))
  };
}

export type PublicMagazinePageView = {
  territory: PublicTerritory;
  edition: Pick<PublicMagazineEdition, "id" | "slug" | "title" | "pageCount">;
  page: { pageNumber: number; title: string };
  /** The page's article, when it has public content. */
  content?: PublicContentCard;
  previous?: { pageNumber: number; title: string };
  next?: { pageNumber: number; title: string };
};

export async function getPublicMagazinePage(db: PublicDb, slug: string, editionSlug: string, pageNumber: number): Promise<PublicMagazinePageView | undefined> {
  const view = await getPublicMagazineEdition(db, slug, editionSlug);
  if (!view) return undefined;

  const pages = view.edition.pages;
  const index = pages.findIndex((page) => page.pageNumber === pageNumber);
  if (index === -1) return undefined;

  const publishing = await loadPublishingData(db);
  const record = publishing.editionPages.find((candidate) =>
    !candidate.deletedAt && candidate.territoryEditionId === view.edition.id && candidate.pageNumber === pageNumber
  );
  const content = record?.assignedContentId
    ? publicContentProjections(publishing, view.territory).find((candidate) => candidate.id === record.assignedContentId)
    : undefined;
  const page = pages[index]!;

  return {
    territory: view.territory,
    edition: { id: view.edition.id, slug: view.edition.slug, title: view.edition.title, pageCount: view.edition.pageCount },
    page: { pageNumber: page.pageNumber, title: page.title },
    content,
    previous: pages[index - 1] ? { pageNumber: pages[index - 1]!.pageNumber, title: pages[index - 1]!.title } : undefined,
    next: pages[index + 1] ? { pageNumber: pages[index + 1]!.pageNumber, title: pages[index + 1]!.title } : undefined
  };
}

export type PublicBusinessDetail = {
  territory: PublicTerritory;
  business: PublicPlacement;
  /** "Sponsored" or "Local business": always shown, never inferred away. */
  label: PublicPlacement["label"];
  structuredData: Record<string, unknown>;
};

/** A business page exists only for an advertiser with a fulfilled, published placement in this territory. */
export async function getPublicBusiness(db: PublicDb, slug: string, advertiserId: string, baseUrl = "http://localhost:3000"): Promise<PublicBusinessDetail | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) return undefined;
  const [publishing, advertising] = await Promise.all([loadPublishingData(db), loadAdvertisingData(db)]);
  const business = publicAdvertiserPlacements(advertising, publishing, territory).find((placement) => placement.advertiserId === advertiserId);
  if (!business) return undefined;

  return {
    territory,
    business,
    label: business.label,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: business.title,
      description: business.summary,
      areaServed: territory.name,
      url: `${baseUrl.replace(/\/$/, "")}${business.href}`
    }
  };
}

export * from "./homepage-template";

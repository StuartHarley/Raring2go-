import { loadAdvertisingData } from "@raring2go/advertising";
import { foundationSeed } from "@raring2go/db";
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
  };
  hero?: PublicContentCard;
  stories: PublicContentCard[];
  whatsOn: PublicContentCard[];
  thingsToDo: PublicContentCard[];
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
  | "newsletter_signup_started"
  | "newsletter_signup_completed"
  | "discovery_item_clicked"
  | "magazine_opened"
  | "commercial_placement_clicked";

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
  key: "r2go-territory-homepage",
  version: 1,
  slots: [
    slot("hero", "Your local family guide", 1),
    slot("stories", "Latest local stories", 4),
    slot("whats_on", "What's on near you", 6),
    slot("things_to_do", "Things to do", 6),
    slot("magazine", "Latest digital magazine", 1),
    slot("offers", "Offers families will love", 4, "sponsored"),
    slot("competitions", "Competitions", 4, "sponsored"),
    slot("advertisers", "Recommended local businesses", 4, "sponsored"),
    slot("newsletter", "Get the local family edit", 1),
    slot("community", "Community and social", 3)
  ]
};

export function publicSeoRoutes(baseUrl = "http://localhost:3000"): PublicSeoRoute[] {
  return publicSeoRoutesFromTerritories(foundationSeed.territories, baseUrl);
}

export async function publicSeoRoutesForDb(db: PublicDb, baseUrl = "http://localhost:3000"): Promise<PublicSeoRoute[]> {
  const publishing = await loadPublishingData(db);
  return publicSeoRoutesFromTerritories(publishing.territories, baseUrl);
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
    metadata: redactAnalyticsMetadata(input.metadata ?? {}),
    privacy: {
      rawIpStored: false,
      userAgentStored: false,
      providerNeutral: true
    }
  };
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
  return data.contentItems
    .map((item) => projectPublicContent(data, item, territory, now))
    .filter((item): item is PublicContentCard => Boolean(item));
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
    })[0];
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

export async function getPublicHomepage(db: PublicDb, slug: string): Promise<PublicHomepage | undefined> {
  const territory = await territoryFromSlugForDb(db, slug);
  if (!territory) {
    return undefined;
  }

  const [publishing, advertising] = await Promise.all([
    loadPublishingData(db),
    loadAdvertisingData(db)
  ]);
  const approvedContent = publicContentProjections(publishing, territory);
  const localStories = approvedContent.filter((item) => item.source === "local");
  const networkStories = approvedContent.filter((item) => item.source === "network");
  const stories = [...localStories, ...networkStories].slice(0, 4);
  const magazine = latestPublishedMagazine(publishing, territory);
  const placements = publicAdvertiserPlacements(advertising, publishing, territory).slice(0, 4);
  const emptyStates: PublicHomepage["emptyStates"] = [];

  if (stories.length === 0) {
    emptyStates.push({
      slot: "stories",
      message: "Approved local stories will appear here once they are published."
    });
  }

  if (placements.length === 0) {
    emptyStates.push({
      slot: "advertisers",
      message: "Local business placements will appear here when booked and approved."
    });
  }

  return {
    territory,
    template: publicHomepageTemplate,
    hero: stories[0],
    stories,
    whatsOn: approvedContent.filter((item) => item.type === "event").slice(0, 6),
    thingsToDo: approvedContent.filter((item) => ["article", "guide"].includes(item.type)).slice(0, 6),
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

  const marketing = await loadMarketingData(db);
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
  const publishing = await loadPublishingData(db);
  const followedTerritories = publishing.territories
    .filter((candidate) => followedIds.has(candidate.id))
    .filter(isPublicTerritoryRecord)
    .map((candidate) => ({
      id: candidate.id,
      slug: territorySlug(candidate.name),
      name: candidate.name
    }));
  const savedContent = marketing.savedContent
    .filter((saved) => saved.contactId === contact.id && !saved.deletedAt)
    .filter((saved) => !saved.territoryId || saved.territoryId === territory.id || followedIds.has(saved.territoryId))
    .map((saved) => ({
      id: saved.id,
      title: saved.title,
      contentType: saved.contentType,
      savedAt: saved.savedAt,
      href: `/areas/${territory.slug}/${saved.contentType === "event" ? "whats-on" : "activities"}/${territorySlug(saved.title)}`
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
  const profile = contactId
    ? marketing?.preferenceProfiles.find((candidate) => candidate.contactId === contactId && !candidate.deletedAt)
    : undefined;
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
    href: item.contentType === "event"
      ? `/areas/${territory.slug}/whats-on/${territorySlug(item.title)}`
      : `/areas/${territory.slug}/activities/${territorySlug(item.title)}`,
    categories: item.categories ?? [],
    tags: item.tags ?? [],
    startDate: stringValue(relevantDates.startDate) ?? stringValue(relevantDates.date),
    endDate: stringValue(relevantDates.endDate),
    location: stringValue(provenance.location) ?? stringValue(provenance.venue)
  };
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

function redactAnalyticsMetadata(metadata: Record<string, unknown>) {
  const blocked = new Set(["email", "emailAddress", "ip", "ipAddress", "userAgent", "name", "phone"]);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.has(key)));
}

export const defaultPublicTerritorySlug = "sutton-coldfield";

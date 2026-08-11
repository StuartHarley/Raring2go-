import { loadAdvertisingData } from "@raring2go/advertising";
import { fixtureIds, foundationSeed } from "@raring2go/db";
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
  return foundationSeed.territories.flatMap((territory) => {
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

export function territorySlug(name: string) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function territoryFromSlug(slug: string): PublicTerritory | undefined {
  const territory = foundationSeed.territories.find((candidate) => territorySlug(candidate.name) === slug);
  if (!territory) {
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

export async function getPublicHomepage(db: PublicDb, slug: string): Promise<PublicHomepage | undefined> {
  const territory = territoryFromSlug(slug);
  if (!territory) {
    return undefined;
  }

  const [publishing, advertising] = await Promise.all([
    loadPublishingData(db),
    loadAdvertisingData(db)
  ]);
  const approvedContent = publishing.contentItems
    .filter((item) => !item.deletedAt)
    .filter((item) => item.status === "approved" || item.status === "published")
    .filter((item) => item.territoryId === territory.id || item.ownerLevel === "network")
    .map((item) => contentCard(item, territory));
  const localStories = approvedContent.filter((item) => item.source === "local");
  const networkStories = approvedContent.filter((item) => item.source === "network");
  const stories = [...localStories, ...networkStories].slice(0, 4);
  const territoryEdition = publishing.territoryEditions
    .filter((edition) => !edition.deletedAt && edition.territoryId === territory.id)
    .sort((left, right) => (right.publicationDate ?? "").localeCompare(left.publicationDate ?? ""))[0];
  const placements = advertising.advertisers
    .filter((advertiser) => !advertiser.deletedAt && advertiser.status === "active")
    .filter((advertiser) => advertiser.owningTerritoryId === territory.id)
    .map((advertiser) => {
      const organisation = advertising.organisations.find((candidate) => candidate.id === advertiser.advertiserOrganisationId);
      return {
        id: advertiser.id,
        title: organisation?.name ?? "Local advertiser",
        label: "Local business" as const,
        summary: "Trusted local family business.",
        href: `/areas/${territory.slug}/businesses/${advertiser.id}`
      };
    })
    .slice(0, 4);
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
    magazine: territoryEdition
      ? {
          id: territoryEdition.id,
          slug: territorySlug(territoryEdition.title),
          title: territoryEdition.title,
          status: territoryEdition.status,
          issueDate: territoryEdition.publicationDate
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
  const territory = territoryFromSlug(slug);
  if (!territory) {
    return undefined;
  }

  const publishing = await loadPublishingData(db);
  const query = (filters.query ?? "").trim().toLowerCase();
  const category = (filters.category ?? "all").trim().toLowerCase();
  const date = filters.date ?? "all";
  const contentTypes = kind === "whats_on" ? new Set(["event"]) : new Set(["article", "guide", "evergreen"]);
  const publicItems = publishing.contentItems
    .filter((item) => !item.deletedAt)
    .filter((item) => item.status === "approved" || item.status === "published")
    .filter((item) => item.territoryId === territory.id || item.ownerLevel === "network")
    .filter((item) => contentTypes.has(item.contentType))
    .map((item) => contentCard(item, territory))
    .filter((item) => matchesQuery(item, query))
    .filter((item) => matchesCategory(item, category))
    .filter((item) => matchesDate(item, date))
    .sort((left, right) => (left.startDate ?? "9999-12-31").localeCompare(right.startDate ?? "9999-12-31"));
  const categories = Array.from(
    new Set(
      publishing.contentItems
        .filter((item) => !item.deletedAt)
        .filter((item) => item.status === "approved" || item.status === "published")
        .filter((item) => item.territoryId === territory.id || item.ownerLevel === "network")
        .filter((item) => contentTypes.has(item.contentType))
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
  const territory = territoryFromSlug(slug);
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
    : publishing.contentItems
      .filter((item) => !item.deletedAt)
      .filter((item) => item.status === "approved" || item.status === "published")
      .filter((item) => item.territoryId === territory.id || item.ownerLevel === "network")
      .filter((item) => contentTypes.has(item.contentType))
      .map((item) => contentCard(item, territory));
  const placements = advertising.advertisers
    .filter((advertiser) => !advertiser.deletedAt)
    .filter((advertiser) => advertiser.status === "active")
    .filter((advertiser) => advertiser.owningTerritoryId === territory.id)
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
  const territory = territoryFromSlug(slug);
  if (!territory) {
    return undefined;
  }

  const publishing = await loadPublishingData(db);
  const editions = publishing.territoryEditions
    .filter((edition) => !edition.deletedAt)
    .filter((edition) => edition.territoryId === territory.id)
    .filter((edition) => edition.status === "published" && edition.digitalStatus === "generated")
    .sort((left, right) => (right.publicationDate ?? "").localeCompare(left.publicationDate ?? ""));
  const edition = editions[0];
  if (!edition) {
    return {
      territory,
      emptyState: "The digital magazine for this area is not public yet. Published generated outputs will appear here."
    };
  }

  const output = publishing.publicationOutputs
    .filter((candidate) => !candidate.deletedAt)
    .filter((candidate) => candidate.territoryEditionId === edition.id)
    .filter((candidate) => candidate.outputType === "digital" && candidate.status === "generated")
    .sort((left, right) => right.version - left.version)[0];
  if (!output) {
    return {
      territory,
      emptyState: "The digital magazine for this area is not public yet. Published generated outputs will appear here."
    };
  }

  const pages = publishing.editionPages
    .filter((page) => !page.deletedAt && page.territoryEditionId === edition.id)
    .filter((page) => page.status === "published")
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .map((page) => ({
      pageNumber: page.pageNumber,
      title: page.assignedContentId
        ? publishing.contentItems.find((item) => item.id === page.assignedContentId)?.title ?? `Page ${page.pageNumber}`
        : `Page ${page.pageNumber}`,
      status: page.status,
      href: `/areas/${territory.slug}/magazine/${territorySlug(edition.title)}/pages/${page.pageNumber}`
    }));

  return {
    territory,
    edition: {
      id: edition.id,
      slug: territorySlug(edition.title),
      title: edition.title,
      issueDate: edition.publicationDate,
      pageCount: edition.pageCount,
      outputVersion: output.version,
      artifact: output.artifact,
      pages
    }
  };
}

export async function getPublicParentHub(
  db: PublicDb,
  slug: string,
  contactId?: string | null
): Promise<PublicParentHub | undefined> {
  const territory = territoryFromSlug(slug);
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
  const followedTerritories = foundationSeed.territories
    .filter((candidate) => followedIds.has(candidate.id))
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
  const territory = territoryFromSlug(slug);
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
  const items = publishing.contentItems
    .filter((item) => !item.deletedAt)
    .filter((item) => item.status === "approved" || item.status === "published")
    .filter((item) => item.territoryId === territory.id || item.ownerLevel === "network")
    .map((item) => {
      const card = contentCard(item, territory);
      return {
        ...card,
        reasons: recommendationReasons(card, preferenceTerms, territory)
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

export const defaultPublicTerritorySlug = territorySlug(
  foundationSeed.territories.find((territory) => territory.id === fixtureIds.territories.suttonColdfield)?.name ??
    "sutton-coldfield"
);

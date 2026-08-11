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

export const defaultPublicTerritorySlug = territorySlug(
  foundationSeed.territories.find((territory) => territory.id === fixtureIds.territories.suttonColdfield)?.name ??
    "sutton-coldfield"
);

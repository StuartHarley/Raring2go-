import { AiOutputError, defineAiTask } from "@raring2go/ai";

export const repurposeChannels = ["magazine", "website", "newsletter", "facebook", "instagram", "linkedin"] as const;
export type RepurposeChannel = (typeof repurposeChannels)[number];

export type ContentRepurposeInput = {
  channel: RepurposeChannel;
  contentItemId: string;
  title: string;
  standfirst?: string | null;
  body: string;
  tags?: string[];
  territoryName?: string | null;
};

export type ChannelOutput = Record<string, unknown>;

// ---- Output normalisation ------------------------------------------------------------

/** Plain text only, bounded, no markup: a model never gets to put HTML into a variant. */
function text(value: unknown, max: number, field: string, required = true): string {
  if (value === undefined || value === null || value === "") {
    if (required) throw new AiOutputError(`The ${field} was missing from the AI output.`);
    return "";
  }
  if (typeof value !== "string") throw new AiOutputError(`The ${field} was not text.`);
  const cleaned = value.replace(/<[^>]*>/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (required && !cleaned) throw new AiOutputError(`The ${field} was empty.`);
  return cleaned.length > max ? cleaned.slice(0, max).trimEnd() : cleaned;
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

const words = (value: string) => value.split(/\s+/).filter(Boolean).length;

/**
 * Normalises a model's reply for one channel into exactly the shape the rest of the
 * platform already consumes. Identifiers and derived fields (slug, block references,
 * word-count target) are set here, never taken from the model.
 */
export function normaliseChannelOutput(channel: RepurposeChannel, raw: unknown, source: { contentItemId: string }): ChannelOutput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AiOutputError("The AI did not return output in the expected shape.");
  }
  const record = raw as Record<string, unknown>;

  switch (channel) {
    case "magazine": {
      const printBody = text(record.printBody, 6_000, "print body");
      return {
        editorialHeadline: text(record.editorialHeadline, 120, "headline"),
        standfirst: text(record.standfirst, 300, "standfirst", false),
        printBody,
        pullQuote: text(record.pullQuote, 200, "pull quote", false),
        wordCountTarget: words(printBody)
      };
    }
    case "website": {
      const webHeadline = text(record.webHeadline, 120, "headline");
      return {
        webHeadline,
        body: text(record.body, 8_000, "body"),
        excerpt: text(record.excerpt, 300, "excerpt", false),
        seoTitle: text(record.seoTitle, 70, "SEO title", false) || `${webHeadline} | Raring2go`.slice(0, 70),
        metaDescription: text(record.metaDescription, 160, "meta description", false),
        slug: slugify(webHeadline),
        cta: text(record.cta, 60, "call to action", false) || "Find more local family ideas"
      };
    }
    case "newsletter":
      return {
        newsletterHeadline: text(record.newsletterHeadline, 90, "headline"),
        summary: text(record.summary, 300, "summary"),
        cta: text(record.cta, 40, "call to action", false) || "Read more",
        block: { type: "article", contentItemId: source.contentItemId }
      };
    case "instagram": {
      const topics = Array.isArray(record.topics) ? record.topics.filter((topic): topic is string => typeof topic === "string").map((topic) => topic.replace(/[^A-Za-z0-9]/g, "").slice(0, 30)).filter(Boolean).slice(0, 5) : [];
      return {
        caption: text(record.caption, 2_200, "caption"),
        shortVariant: text(record.shortVariant, 125, "short variant", false),
        topics,
        imageBrief: text(record.imageBrief, 300, "image brief", false)
      };
    }
    case "linkedin":
      return { postCopy: text(record.postCopy, 1_300, "post"), cta: text(record.cta, 40, "call to action", false) || "View the full update" };
    case "facebook": {
      const alternates = Array.isArray(record.alternateVersions) ? record.alternateVersions.filter((entry): entry is string => typeof entry === "string").map((entry) => text(entry, 300, "alternate", false)).filter(Boolean).slice(0, 2) : [];
      return { postCopy: text(record.postCopy, 1_000, "post"), cta: text(record.cta, 40, "call to action", false) || "Read more", alternateVersions: alternates };
    }
  }
}

// ---- Fact guard ----------------------------------------------------------------------

const FACT_PATTERNS = [
  /https?:\/\/[^\s)]+/gi, // links
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // emails
  /£\s?\d[\d,.]*/g, // prices
  /\b\d{1,2}[:.]\d{2}\s?(?:am|pm)?\b/gi, // times
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi, // dates like "12 March"
  /\b\d{2,}\b/g // other multi-digit numbers
];

const norm = (value: string) => value.toLowerCase().replace(/[\s,]+/g, "");

function collectFacts(value: string) {
  const facts = new Set<string>();
  for (const pattern of FACT_PATTERNS) for (const match of value.matchAll(pattern)) facts.add(match[0].trim().replace(/[.,;:!?)]+$/, ""));
  return facts;
}

function flatten(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((entry) => flatten(entry, out));
  else if (value && typeof value === "object") Object.values(value).forEach((entry) => flatten(entry, out));
  return out;
}

/**
 * Specific claims (links, prices, times, dates, numbers) in the output that do not appear in
 * the source. Not a block (copy can legitimately say "5 ideas"), but a prompt for a human
 * to check before approving. Derived fields are excluded.
 */
export function findUnsupportedFacts(sourceText: string, output: ChannelOutput): string[] {
  const { slug: _slug, wordCountTarget: _words, block: _block, ...checked } = output;
  const known = norm(sourceText);
  const unsupported: string[] = [];
  for (const fact of collectFacts(flatten(checked).join("\n"))) {
    if (!known.includes(norm(fact)) && !unsupported.includes(fact)) unsupported.push(fact);
  }
  return unsupported.slice(0, 10);
}

// ---- Task ----------------------------------------------------------------------------

const GUIDE: Record<RepurposeChannel, { shape: string; guidance: string; maxTokens: number }> = {
  magazine: { shape: '{"editorialHeadline","standfirst","printBody","pullQuote"}', guidance: "Print magazine feature: tighter and more editorial, 250-450 words in printBody, a quotable pullQuote taken from the text.", maxTokens: 1500 },
  website: { shape: '{"webHeadline","body","excerpt","seoTitle","metaDescription","cta"}', guidance: "Website article: scannable paragraphs, seoTitle under 60 characters, metaDescription under 155 characters.", maxTokens: 2000 },
  newsletter: { shape: '{"newsletterHeadline","summary","cta"}', guidance: "Newsletter teaser: a short, inviting summary (1-2 sentences) that makes parents click through.", maxTokens: 500 },
  facebook: { shape: '{"postCopy","cta","alternateVersions"}', guidance: "Facebook post: friendly and conversational, under 100 words; alternateVersions is up to two shorter options.", maxTokens: 700 },
  instagram: { shape: '{"caption","shortVariant","topics","imageBrief"}', guidance: "Instagram caption: warm and visual; topics are up to 5 single words (no # or spaces); imageBrief describes a suitable family photo.", maxTokens: 700 },
  linkedin: { shape: '{"postCopy","cta"}', guidance: "LinkedIn update: professional but warm, aimed at local businesses and partners, under 150 words.", maxTokens: 600 }
};

export const contentRepurposeTask = defineAiTask<ContentRepurposeInput, ChannelOutput>({
  key: "content.repurpose",
  promptVersion: "content-repurpose.v1",
  purpose: "Repurpose approved content for a channel",
  risk: "low",
  // Each variant is reviewed and approved in Content Studio before it can be used.
  approval: "review",
  capability: { module: "content.ai", action: "generate" },
  maxTokens: 2000,
  system:
    "You adapt an existing article for a specific channel for Raring2go!, a UK network of local family magazines and websites. British English. " +
    "Use ONLY facts present in the source: never add dates, times, prices, venues, names, quotes or links that are not in it. " +
    "Respond with ONLY a JSON object (no markdown fences, no preamble). Plain text values only: no HTML.",
  buildUserPrompt: (input) =>
    `Channel: ${input.channel}\nShape: ${GUIDE[input.channel].shape}\nGuidance: ${GUIDE[input.channel].guidance}\n` +
    (input.territoryName ? `Territory: ${input.territoryName}\n` : "") +
    `\nSOURCE TITLE: ${input.title}\nSOURCE STANDFIRST: ${input.standfirst ?? ""}\nSOURCE BODY:\n${input.body.slice(0, 6000)}`,
  parse: (raw, input) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new AiOutputError("The AI did not return a usable variant. Try again.");
    }
    return normaliseChannelOutput(input.channel, parsed, input);
  },
  fromStructured: (raw, input) => normaliseChannelOutput(input.channel, raw, input),
  structuredInput: (input) => ({ channel: input.channel, title: input.title, standfirst: input.standfirst ?? null, body: input.body, tags: input.tags ?? [], territory: input.territoryName ?? null }),
  deterministic: (input) => {
    const lead = input.standfirst || input.title;
    switch (input.channel) {
      case "magazine":
        return normaliseChannelOutput("magazine", { editorialHeadline: input.title, standfirst: input.standfirst, printBody: input.body, pullQuote: lead }, input);
      case "website":
        return normaliseChannelOutput("website", { webHeadline: input.title, body: input.body, excerpt: input.standfirst, metaDescription: lead }, input);
      case "newsletter":
        return normaliseChannelOutput("newsletter", { newsletterHeadline: input.title, summary: lead }, input);
      case "instagram":
        return normaliseChannelOutput("instagram", { caption: `${input.title}. ${input.standfirst ?? ""}`.trim(), shortVariant: input.title, topics: (input.tags ?? []).slice(0, 5), imageBrief: "Warm family editorial image suitable for Raring2go social." }, input);
      case "linkedin":
        return normaliseChannelOutput("linkedin", { postCopy: `${input.title}: ${input.standfirst ?? "A Raring2go network update."}` }, input);
      default:
        return normaliseChannelOutput("facebook", { postCopy: `${input.title}\n\n${input.standfirst ?? ""}`.trim(), alternateVersions: [input.title] }, input);
    }
  },
  summariseInput: (input) => ({ channel: input.channel, title: input.title, territory: input.territoryName ?? null, bodyLength: input.body.length }),
  sources: (input) => [{ type: "content_item", id: input.contentItemId, label: input.title }]
});

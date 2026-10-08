import { defineAiTask } from "@raring2go/ai";
import { asArray, asRecord, parseJsonObject, plainText } from "../sanitise";
import { allowedAmounts, assessRenewalRisk, nextBestActions, packageIdeas, renderFacts } from "./facts";
import type { CataloguePackage, NextAction, PackageIdea, RenewalRisk, SalesFacts } from "./facts";

// ---- Advertiser brief ------------------------------------------------------------------------------------

export type AdvertiserBriefInput = { facts: SalesFacts; catalogue: CataloguePackage[]; today: string };

export type AdvertiserBriefOutput = {
  summary: string;
  /** Computed from the record, never taken from the model. */
  renewalRisk: { level: RenewalRisk["level"]; score: number; reasons: string[]; explanation: string };
  actions: NextAction[];
  nextBestAction: { action: string; why: string };
  objections: Array<{ objection: string; response: string }>;
  packageIdeas: Array<PackageIdea & { why: string }>;
};

const GENERIC_OBJECTIONS: Array<{ objection: string; response: string }> = [
  { objection: "It is too expensive right now.", response: "Acknowledge it, then point to what they have actually got from past campaigns (proof packs) and offer a smaller package or a shorter commitment rather than a discount." },
  { objection: "We are not sure it brings us customers.", response: "Share the results from their last campaign and the readership numbers for the territory, and agree one measurable thing to track this time." },
  { objection: "Now is not a good time.", response: "Ask what would make it a better time, agree a specific date to come back, and put it in their record as the next step." }
];

function deterministicBrief(input: AdvertiserBriefInput): AdvertiserBriefOutput {
  const now = new Date(`${input.today}T00:00:00Z`);
  const risk = assessRenewalRisk(input.facts, now);
  const actions = nextBestActions(input.facts, now);
  const ideas = packageIdeas(input.facts, input.catalogue);
  const top = actions[0];
  return {
    summary:
      `${input.facts.advertiserName} is ${input.facts.relationshipState}` +
      (input.facts.lastBookedOn ? `, last booked on ${input.facts.lastBookedOn}` : " and has never booked") +
      `. ${input.facts.openOpportunities.length} open opportunit${input.facts.openOpportunities.length === 1 ? "y" : "ies"}; renewal risk is ${risk.level}.`,
    renewalRisk: { level: risk.level, score: risk.score, reasons: risk.reasons, explanation: risk.reasons[0] ?? "" },
    actions,
    nextBestAction: top ? { action: top.action, why: top.reason } : { action: "Check in with them", why: "Nothing urgent stands out." },
    objections: GENERIC_OBJECTIONS,
    packageIdeas: ideas.map((idea) => ({ ...idea, why: idea.reason }))
  };
}

/**
 * Merge a model's words into the computed brief. The renewal level, score, reasons and the action list always
 * come from the rules; the model contributes the summary, the explanation, wording for the top action, objection
 * handling, and a reason for each package idea. A package the model invents (not in the offered ideas) is dropped.
 */
export function mergeAdvertiserBrief(raw: unknown, input: AdvertiserBriefInput): AdvertiserBriefOutput {
  const base = deterministicBrief(input);
  const record = asRecord(raw, "an advertiser brief");
  const risk = asRecord(record.renewalRisk ?? {}, "renewal risk");
  const next = asRecord(record.nextBestAction ?? {}, "a next best action");

  const objections = asArray(record.objections, 4)
    .map((entry) => {
      const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      return { objection: plainText(e.objection, 200, "objection"), response: plainText(e.response, 400, "response") };
    })
    .filter((entry) => entry.objection && entry.response);

  const ideaByName = new Map(base.packageIdeas.map((idea) => [idea.name.toLowerCase(), idea]));
  const ideas = asArray(record.packageIdeas, 3)
    .map((entry) => {
      const e = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const known = typeof e.name === "string" ? ideaByName.get(e.name.toLowerCase()) : undefined;
      return known ? { ...known, why: plainText(e.why, 300, "reason") || known.reason } : undefined;
    })
    .filter((idea): idea is NonNullable<typeof idea> => Boolean(idea));

  return {
    summary: plainText(record.summary, 900, "summary") || base.summary,
    renewalRisk: { ...base.renewalRisk, explanation: plainText(risk.explanation, 500, "risk explanation") || base.renewalRisk.explanation },
    actions: base.actions,
    nextBestAction: { action: plainText(next.action, 200, "action") || base.nextBestAction.action, why: plainText(next.why, 400, "reason") || base.nextBestAction.why },
    objections: objections.length ? objections : base.objections,
    packageIdeas: ideas.length ? ideas : base.packageIdeas
  };
}

export const advertiserBriefTask = defineAiTask<AdvertiserBriefInput, AdvertiserBriefOutput>({
  key: "sales.advertiser_brief",
  promptVersion: "advertiser-brief.v1",
  purpose: "Brief a salesperson on an advertiser: summary, renewal risk, next action and likely objections",
  risk: "low",
  approval: "none",
  capability: { module: "advertiser", action: "ai_assist" },
  maxTokens: 1400,
  system:
    "You help a salesperson at Raring2go!, a UK network of local family magazines, prepare to talk to an advertiser. " +
    "You are given the facts from their record, a computed renewal risk with reasons, and ranked next actions. " +
    "Write a short, practical brief in British English using ONLY those facts: never invent bookings, results, prices, dates, names or promises. " +
    "Do not change the renewal risk level or the actions; explain and word them. Suggest only package ideas from the list given. " +
    "Respond with ONLY a JSON object of the exact shape " +
    '{"summary": string, "renewalRisk": {"explanation": string}, "nextBestAction": {"action": string, "why": string}, "objections": [{"objection": string, "response": string}], "packageIdeas": [{"name": string, "why": string}]} ' +
    "(no markdown fences, no preamble). Plain text only.",
  buildUserPrompt: (input) => {
    const now = new Date(`${input.today}T00:00:00Z`);
    const risk = assessRenewalRisk(input.facts, now);
    const actions = nextBestActions(input.facts, now);
    const ideas = packageIdeas(input.facts, input.catalogue);
    return (
      `Today: ${input.today}\n${renderFacts(input.facts, now)}\n\n` +
      `Computed renewal risk: ${risk.level} (${risk.score}/100)\nReasons:\n${risk.reasons.map((r) => `- ${r}`).join("\n")}\n\n` +
      `Ranked next actions:\n${actions.map((a, i) => `${i + 1}. ${a.action} (${a.reason})`).join("\n") || "none"}\n\n` +
      `Package ideas to choose from:\n${ideas.map((i) => `- ${i.name}: ${i.reason}`).join("\n") || "none"}`
    );
  },
  parse: (text, input) => mergeAdvertiserBrief(parseJsonObject(text, "an advertiser brief"), input),
  deterministic: deterministicBrief,
  summariseInput: (input) => ({ advertiser: input.facts.advertiserName, relationship: input.facts.relationshipState, openOpportunities: input.facts.openOpportunities.length, catalogueSize: input.catalogue.length }),
  sources: (input) => [{ type: "advertiser", label: input.facts.advertiserName }]
});

// ---- Outreach draft --------------------------------------------------------------------------------------

export const outreachPurposes = ["intro", "follow_up", "renewal", "objection_reply", "thank_you"] as const;
export type OutreachPurpose = (typeof outreachPurposes)[number];

export type OutreachDraftInput = {
  facts: SalesFacts;
  purpose: OutreachPurpose;
  senderName: string;
  /** The salesperson's own talking points. The draft may use these but must not add to them. */
  talkingPoints?: string | null;
};

export type OutreachDraftOutput = { subject: string; body: string; notes: string };

const MONEY = /£\s?\d[\d,]*(?:\.\d{1,2})?/g;

/**
 * A draft may mention only money amounts that are in the facts. Anything else is replaced with a visible
 * placeholder, and the writer is told, so a made-up price never reaches an advertiser by accident.
 */
export function redactUnknownAmounts(body: string, allowed: Set<string>): { text: string; redacted: number } {
  let redacted = 0;
  const normalise = (value: string) => value.replace(/\s/g, "").replace(/\.00$/, "");
  const allowedNormalised = new Set([...allowed].map((amount) => normalise(amount.replace(/\.00$/, ""))));
  const text = body.replace(MONEY, (match) => {
    if (allowedNormalised.has(normalise(match))) return match;
    redacted += 1;
    return "[amount to confirm]";
  });
  return { text, redacted };
}

const PURPOSE_LABEL: Record<OutreachPurpose, string> = {
  intro: "an introduction to a business that has not advertised with us before",
  follow_up: "a follow-up to a recent conversation or proposal",
  renewal: "an invitation to renew or book their next campaign",
  objection_reply: "a reply to an objection they raised",
  thank_you: "a thank-you after a campaign"
};

function deterministicOutreach(input: OutreachDraftInput): OutreachDraftOutput {
  const { facts, purpose, senderName } = input;
  const name = facts.advertiserName;
  const place = facts.territoryName ?? "your area";
  const points = input.talkingPoints?.trim();
  const closing = `Kind regards,\n${senderName}`;
  const subjects: Record<OutreachPurpose, string> = {
    intro: `Reaching local families in ${place}`,
    follow_up: `Following up: ${name}`,
    renewal: `Planning your next campaign, ${name}`,
    objection_reply: `Re: your question`,
    thank_you: `Thank you, ${name}`
  };
  const bodies: Record<OutreachPurpose, string> = {
    intro: `Hello,\n\nI'm ${senderName} from Raring2go!, the family magazine and website for ${place}. I'd love to talk about how ${name} could reach local parents.${points ? `\n\n${points}` : ""}\n\nWould you be free for a short chat this week?\n\n${closing}`,
    follow_up: `Hello,\n\nThank you for talking with us recently. I wanted to follow up on what we discussed${facts.proposals.find((p) => p.status === "sent") ? ` and the proposal "${facts.proposals.find((p) => p.status === "sent")!.title}"` : ""}.${points ? `\n\n${points}` : ""}\n\nIs there anything I can clarify or adjust?\n\n${closing}`,
    renewal: `Hello,\n\nYour last booking with us${facts.lastBookedOn ? ` was on ${facts.lastBookedOn}` : " has finished"}, and I'd like to help you plan what comes next.${points ? `\n\n${points}` : ""}\n\nCould we find a time to look at the options together?\n\n${closing}`,
    objection_reply: `Hello,\n\nThank you for being open about this. I understand.${points ? `\n\n${points}` : ""}\n\nI'd be glad to find an approach that works for ${name}.\n\n${closing}`,
    thank_you: `Hello,\n\nThank you for advertising with Raring2go!. It was a pleasure working with ${name}.${points ? `\n\n${points}` : ""}\n\nI'll be in touch with how the campaign performed.\n\n${closing}`
  };
  return { subject: subjects[purpose], body: bodies[purpose], notes: "Template draft, written without an AI model. Check every detail and add your own before sending." };
}

export const outreachDraftTask = defineAiTask<OutreachDraftInput, OutreachDraftOutput>({
  key: "sales.outreach_draft",
  promptVersion: "outreach-draft.v1",
  purpose: "Draft an email to an advertiser",
  risk: "low",
  approval: "review",
  capability: { module: "advertiser", action: "ai_assist" },
  maxTokens: 900,
  system:
    "You draft short, warm, professional emails from a salesperson at Raring2go!, a UK network of local family magazines and websites, to a local business. " +
    "British English, plain and human, no hype. Use ONLY the facts and talking points supplied: never invent prices, discounts, dates, results, readership numbers, customers or promises. " +
    "Where a specific is needed but not supplied, write a clear placeholder in square brackets such as [date] or [amount]. Do not include links. " +
    "Respond with ONLY a JSON object of the exact shape " +
    '{"subject": string, "body": string, "notes": string} ' +
    "where notes lists anything the sender should check before sending (no markdown fences, no preamble). Plain text only.",
  buildUserPrompt: (input) =>
    `Write ${PURPOSE_LABEL[input.purpose]}.\nSender: ${input.senderName}\n\n${renderFacts(input.facts)}\n` + (input.talkingPoints?.trim() ? `\nTalking points from the sender (use these, add nothing):\n${input.talkingPoints.trim().slice(0, 1200)}` : ""),
  parse: (text, input) => {
    const record = parseJsonObject(text, "an email draft");
    const guarded = redactUnknownAmounts(plainText(record.body, 3000, "body", { required: true }), allowedAmounts(input.facts));
    const notes = plainText(record.notes, 600, "notes");
    return {
      subject: plainText(record.subject, 160, "subject", { required: true }),
      body: guarded.text,
      notes: guarded.redacted ? `${guarded.redacted} amount${guarded.redacted === 1 ? " was" : "s were"} not in the advertiser's record and ${guarded.redacted === 1 ? "has" : "have"} been replaced with a placeholder: confirm ${guarded.redacted === 1 ? "it" : "them"}. ${notes}`.trim() : notes
    };
  },
  deterministic: deterministicOutreach,
  summariseInput: (input) => ({ advertiser: input.facts.advertiserName, purpose: input.purpose, hasTalkingPoints: Boolean(input.talkingPoints?.trim()) }),
  sources: (input) => [{ type: "advertiser", label: input.facts.advertiserName }]
});

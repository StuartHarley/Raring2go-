import { escapeHtml } from "./blocks";
import type { Block } from "./blocks";
import { sanitizeRichTextHtml } from "./html-sanitize";
import type { JourneyStep, JourneyTrigger } from "./types";

/**
 * Content a journey fills in when someone enters it, for journeys whose message depends on what is happening: a school
 * holiday's name and dates, this week's local events. A step writes `[[token]]` (plain text) or `[[token|html]]` (a list
 * built by trusted code) in its subject, headings and text blocks. The tokens each trigger may use are fixed here, a
 * journey that uses any other is refused when it is created, and a value is escaped (or sanitised, for html) as it is
 * filled in. Written as `[[ ]]` so it can never be confused with the per-recipient `{{firstName}}` tags.
 */

const TOKENS_BY_TRIGGER: Record<JourneyTrigger["type"], string[]> = {
  contact_subscribed_to_territory: [],
  contact_inactive: [],
  digital_edition_published: [],
  school_holiday_approaching: ["holiday_name", "holiday_starts", "holiday_ends", "days_until", "area_name"],
  weekly_digest: ["local_events", "area_name"]
};

/** Tokens that carry a block of HTML built by our own code; everything else is plain text. */
const HTML_TOKENS = new Set(["local_events"]);

const TOKEN_PATTERN = /\[\[\s*([a-z_]+)\s*(?:\|\s*(html)\s*)?\]\]/g;

export type JourneyContentField = { value: string; html?: boolean };
export type JourneyEntryContent = { variantKey: string; fields: Record<string, JourneyContentField> };

export class JourneyContentUnavailableError extends Error {
  constructor(message = "The content this journey step needs is not available.") {
    super(message);
    this.name = "JourneyContentUnavailableError";
  }
}

export function allowedJourneyContentTokens(trigger: JourneyTrigger): string[] {
  return TOKENS_BY_TRIGGER[trigger.type] ?? [];
}

function tokensIn(text: string) {
  return [...text.matchAll(TOKEN_PATTERN)].map((match) => ({ name: match[1]!, html: match[2] === "html" }));
}

/** Tokens may sit in the subject, headings and text blocks only, and only the ones the trigger provides. */
export function assertJourneyContentTokens(trigger: JourneyTrigger, steps: JourneyStep[]) {
  const allowed = new Set(allowedJourneyContentTokens(trigger));
  const check = (text: string, where: string, htmlOk: boolean) => {
    for (const token of tokensIn(text)) {
      if (!allowed.has(token.name)) throw new Error(`The token [[${token.name}]] in ${where} is not available for this kind of journey.`);
      if (token.html && !HTML_TOKENS.has(token.name)) throw new Error(`[[${token.name}|html]] in ${where} is not an html field.`);
      if (!token.html && HTML_TOKENS.has(token.name)) throw new Error(`[[${token.name}]] in ${where} must be written [[${token.name}|html]].`);
      if (token.html && !htmlOk) throw new Error(`[[${token.name}|html]] can only be used in a text block, not in ${where}.`);
    }
  };
  for (const step of steps) {
    check(step.email.subject, `the subject of step "${step.key}"`, false);
    for (const block of step.email.blocks) {
      if (block.type === "text") check(block.html, `a text block of step "${step.key}"`, true);
      else if (block.type === "heading") check(block.text, `a heading of step "${step.key}"`, false);
      else if (JSON.stringify(block).includes("[[")) throw new Error(`Tokens can only be used in the subject, headings and text blocks (step "${step.key}").`);
    }
  }
}

export function stepUsesContentTokens(step: JourneyStep): boolean {
  return tokensIn(step.email.subject).length > 0 || step.email.blocks.some((block) => (block.type === "text" ? tokensIn(block.html).length > 0 : block.type === "heading" ? tokensIn(block.text).length > 0 : false));
}

/** Fills a step's content. A token with no value stops the send (the caller skips the step) rather than emailing a blank. */
export function fillJourneyContent(email: { subject: string; blocks: Block[] }, content: JourneyEntryContent | undefined): { subject: string; blocks: Block[] } {
  const fill = (text: string, mode: "plain" | "html") =>
    text.replace(TOKEN_PATTERN, (_match, name: string, html: string | undefined) => {
      const field = content?.fields[name];
      if (!field || field.value === "") throw new JourneyContentUnavailableError();
      if (html) return sanitizeRichTextHtml(field.value);
      const plain = field.value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      return mode === "html" ? escapeHtml(plain) : plain;
    });
  return {
    subject: fill(email.subject, "plain"),
    blocks: email.blocks.map((block) => (block.type === "text" ? { ...block, html: fill(block.html, "html") } : block.type === "heading" ? { ...block, text: fill(block.text, "plain") } : block))
  };
}

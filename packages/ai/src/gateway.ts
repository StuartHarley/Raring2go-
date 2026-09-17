import Anthropic from "@anthropic-ai/sdk";

export type SubjectLineSuggestionInput = {
  campaignTitle: string;
  bodyPreviewText: string;
  audienceDescription?: string | null;
};

export type ContentSuggestionInput = {
  campaignTitle: string;
  existingText?: string | null;
  instructions?: string | null;
};

export type CampaignDraftInput = {
  prompt: string;
  audienceDescription?: string | null;
};

/**
 * Deliberately narrow: no id (the caller assigns fresh ids, same as every
 * other "populate a whole draft" path in this app), no image/button blocks
 * (the model can't produce a real image, and has no way to know a real link
 * target for a button without hallucinating one).
 */
export type CampaignDraftBlock =
  | { type: "heading"; text: string; level: 1 | 2 }
  | { type: "text"; html: string }
  | { type: "divider" };

export type CampaignDraft = {
  subject: string;
  blocks: CampaignDraftBlock[];
};

export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiSuggestionResult<T> = {
  output: T;
  providerKey: string;
  modelReference: string;
  promptTemplateVersion: string;
  usage: AiUsage;
};

/**
 * The common AI gateway (AGENTS.md: "Use the common AI gateway; do not call
 * models directly from UI code"). Every suggestion is exactly that — the
 * caller decides whether to use it; nothing here ever writes back to a
 * campaign on its own.
 */
export type AiGateway = {
  key: string;
  generateSubjectLines(input: SubjectLineSuggestionInput): Promise<AiSuggestionResult<string[]>>;
  generateContentSuggestion(input: ContentSuggestionInput): Promise<AiSuggestionResult<string>>;
  generateCampaignDraft(input: CampaignDraftInput): Promise<AiSuggestionResult<CampaignDraft>>;
};

const SUBJECT_LINES_PROMPT_VERSION = "mkt-ai-subject.v1";
const CONTENT_SUGGESTION_PROMPT_VERSION = "mkt-ai-content.v1";
const CAMPAIGN_DRAFT_PROMPT_VERSION = "mkt-ai-campaign-draft.v1";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function createAnthropicAiGateway(input: { apiKey: string; model?: string; client?: Anthropic }): AiGateway {
  if (!input.apiKey) {
    throw new Error("Anthropic AI gateway requires an API key.");
  }

  const model = input.model ?? DEFAULT_MODEL;
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });

  return {
    key: "anthropic",
    async generateSubjectLines(subjectInput) {
      const message = await client.messages.create({
        model,
        max_tokens: 300,
        system:
          "You write short, warm, concrete subject lines for a UK local-family-events newsletter. " +
          "Respond with ONLY a JSON array of 3 short subject line strings (no markdown, no preamble, no explanation). " +
          "Each subject line must be under 60 characters.",
        messages: [
          {
            role: "user",
            content: `Campaign title: ${subjectInput.campaignTitle}\n${
              subjectInput.audienceDescription ? `Audience: ${subjectInput.audienceDescription}\n` : ""
            }Newsletter content preview:\n${subjectInput.bodyPreviewText.slice(0, 2000)}`
          }
        ]
      });

      const subjectLines = parseJsonStringArray(textFromMessage(message));

      return {
        output: subjectLines,
        providerKey: "anthropic",
        modelReference: model,
        promptTemplateVersion: SUBJECT_LINES_PROMPT_VERSION,
        usage: usageFromMessage(message)
      };
    },
    async generateContentSuggestion(contentInput) {
      const message = await client.messages.create({
        model,
        max_tokens: 400,
        system:
          "You write short, warm, concrete paragraph copy for a UK local-family-events newsletter block. " +
          "Respond with ONLY the suggested paragraph text (plain text, no markdown, no preamble, no quotes around it).",
        messages: [
          {
            role: "user",
            content: `Campaign title: ${contentInput.campaignTitle}\n${
              contentInput.existingText ? `Current text to improve:\n${contentInput.existingText}\n` : "Write a new paragraph for this block.\n"
            }${contentInput.instructions ? `Instructions: ${contentInput.instructions}` : ""}`
          }
        ]
      });

      return {
        output: textFromMessage(message).trim(),
        providerKey: "anthropic",
        modelReference: model,
        promptTemplateVersion: CONTENT_SUGGESTION_PROMPT_VERSION,
        usage: usageFromMessage(message)
      };
    },
    async generateCampaignDraft(draftInput) {
      const message = await client.messages.create({
        model,
        max_tokens: 1500,
        system:
          "You draft short, warm, concrete newsletter campaigns for a UK local-family-events audience, from a one-line brief. " +
          "Respond with ONLY a JSON object of the exact shape {\"subject\": string, \"blocks\": Array<Block>} (no markdown, no preamble, no explanation). " +
          "Block is one of: {\"type\":\"heading\",\"text\":string,\"level\":1|2}, {\"type\":\"text\",\"html\":string}, {\"type\":\"divider\"}. " +
          "Use 3 to 6 blocks. Each text block's html should be one or two short <p> paragraphs, plain HTML only (no scripts, no styles, no classes). " +
          "Never invent a link, a button, an image, a price, a date or a fact not present in the brief.",
        messages: [
          {
            role: "user",
            content: `Brief: ${draftInput.prompt}\n${
              draftInput.audienceDescription ? `Audience: ${draftInput.audienceDescription}\n` : ""
            }`
          }
        ]
      });

      return {
        output: parseCampaignDraft(textFromMessage(message)),
        providerKey: "anthropic",
        modelReference: model,
        promptTemplateVersion: CAMPAIGN_DRAFT_PROMPT_VERSION,
        usage: usageFromMessage(message)
      };
    }
  };
}

/**
 * A deterministic, no-network gateway — used in tests, and by
 * createAiGatewayFromEnv when AI_PROVIDER is unset, so the compose flow can
 * always be exercised end to end without a real API key.
 */
export function createDeterministicAiGateway(): AiGateway {
  return {
    key: "deterministic",
    async generateSubjectLines(input) {
      const base = input.campaignTitle.trim() || "Newsletter update";
      return {
        output: [`${base} — inside this week`, `Don't miss: ${base}`, `${base} for your family`],
        providerKey: "deterministic",
        modelReference: "deterministic-subject-template",
        promptTemplateVersion: SUBJECT_LINES_PROMPT_VERSION,
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    },
    async generateContentSuggestion(input) {
      const base = input.campaignTitle.trim() || "this newsletter";
      return {
        output: `Here's what's happening with ${base} this week — come and join us for something fun and local.`,
        providerKey: "deterministic",
        modelReference: "deterministic-content-template",
        promptTemplateVersion: CONTENT_SUGGESTION_PROMPT_VERSION,
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    },
    async generateCampaignDraft(input) {
      const base = input.prompt.trim() || "This week's newsletter";
      return {
        output: {
          subject: `${base} — inside this week`,
          blocks: [
            { type: "heading", text: base, level: 1 },
            { type: "text", html: `<p>Here's what's happening: ${base.toLowerCase()}.</p>` },
            { type: "divider" },
            { type: "text", html: "<p>Come and join us — see you there!</p>" }
          ]
        },
        providerKey: "deterministic",
        modelReference: "deterministic-campaign-draft-template",
        promptTemplateVersion: CAMPAIGN_DRAFT_PROMPT_VERSION,
        usage: { inputTokens: 0, outputTokens: 0 }
      };
    }
  };
}

export function createAiGatewayFromEnv(source: NodeJS.ProcessEnv = process.env): AiGateway | undefined {
  const provider = source.AI_PROVIDER ?? "none";

  if (provider === "none") {
    return undefined;
  }

  if (provider === "deterministic") {
    return createDeterministicAiGateway();
  }

  if (provider === "anthropic") {
    if (!source.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.");
    }

    return createAnthropicAiGateway({ apiKey: source.ANTHROPIC_API_KEY, model: source.AI_MODEL });
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

function textFromMessage(message: Anthropic.Messages.Message): string {
  return message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function usageFromMessage(message: Anthropic.Messages.Message): AiUsage {
  return {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens
  };
}

/**
 * Best-effort parse of the model's {"subject","blocks"} JSON. Deliberately
 * strict about block shape (falls back to dropping an unrecognised block
 * rather than guessing its fields) - the real, unforgiving validation still
 * happens downstream via validateBlocks; this is just enough shape-checking
 * to avoid handing a caller garbage before that boundary.
 */
function parseCampaignDraft(text: string): CampaignDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return { subject: "", blocks: [] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { subject: "", blocks: [] };
  }

  const record = parsed as Record<string, unknown>;
  const subject = typeof record.subject === "string" ? record.subject : "";
  const rawBlocks = Array.isArray(record.blocks) ? record.blocks : [];

  const blocks: CampaignDraftBlock[] = rawBlocks.flatMap((entry): CampaignDraftBlock[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const block = entry as Record<string, unknown>;

    if (block.type === "heading" && typeof block.text === "string" && (block.level === 1 || block.level === 2)) {
      return [{ type: "heading", text: block.text, level: block.level }];
    }
    if (block.type === "text" && typeof block.html === "string") {
      return [{ type: "text", html: block.html }];
    }
    if (block.type === "divider") {
      return [{ type: "divider" }];
    }
    return [];
  });

  return { subject, blocks };
}

function parseJsonStringArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // fall through to the line-based fallback below
  }

  // Best-effort fallback if the model didn't return clean JSON: treat each
  // non-empty line as a suggestion.
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

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
};

const SUBJECT_LINES_PROMPT_VERSION = "mkt-ai-subject.v1";
const CONTENT_SUGGESTION_PROMPT_VERSION = "mkt-ai-content.v1";
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

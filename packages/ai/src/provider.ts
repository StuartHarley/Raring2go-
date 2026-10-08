import Anthropic from "@anthropic-ai/sdk";
import type { AiUsage } from "./gateway";

export type AiCompletionRequest = {
  system: string;
  user: string;
  maxTokens: number;
};

export type AiCompletion = {
  text: string;
  usage: AiUsage;
  modelReference: string;
};

/**
 * Provider adapter. Domain code never sees a vendor SDK: tasks describe a prompt, a
 * provider turns it into text. `deterministic` providers have no model, so the runner
 * asks the task for its own template output instead.
 */
export type AiProvider = {
  key: string;
  deterministic: boolean;
  complete(request: AiCompletionRequest): Promise<AiCompletion>;
};

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

export function createAnthropicProvider(input: { apiKey: string; model?: string; client?: Anthropic }): AiProvider {
  if (!input.apiKey) {
    throw new Error("Anthropic provider requires an API key.");
  }
  const model = input.model ?? DEFAULT_MODEL;
  const client = input.client ?? new Anthropic({ apiKey: input.apiKey });

  return {
    key: "anthropic",
    deterministic: false,
    async complete(request) {
      const message = await client.messages.create({
        model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: [{ role: "user", content: request.user }]
      });

      return {
        text: message.content
          .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
        modelReference: model
      };
    }
  };
}

export function createDeterministicProvider(): AiProvider {
  return {
    key: "deterministic",
    deterministic: true,
    async complete() {
      throw new Error("The deterministic provider has no model; tasks supply their own template output.");
    }
  };
}

export function createAiProviderFromEnv(source: NodeJS.ProcessEnv = process.env): AiProvider | undefined {
  const provider = source.AI_PROVIDER ?? "none";

  if (provider === "none") return undefined;
  if (provider === "deterministic") return createDeterministicProvider();
  if (provider === "anthropic") {
    if (!source.ANTHROPIC_API_KEY) {
      throw new Error("AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY.");
    }
    return createAnthropicProvider({ apiKey: source.ANTHROPIC_API_KEY, model: source.AI_MODEL });
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

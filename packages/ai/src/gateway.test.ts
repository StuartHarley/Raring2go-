import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { createAiGatewayFromEnv, createAnthropicAiGateway, createDeterministicAiGateway } from "./gateway";

function fakeMessage(text: string, usage: { input_tokens: number; output_tokens: number } = { input_tokens: 120, output_tokens: 40 }): Anthropic.Messages.Message {
  return { content: [{ type: "text", text }], usage } as unknown as Anthropic.Messages.Message;
}

function fakeClient(text: string, usage?: { input_tokens: number; output_tokens: number }): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => fakeMessage(text, usage))
    }
  } as unknown as Anthropic;
}

describe("createDeterministicAiGateway", () => {
  it("returns three template subject line suggestions using the campaign title", async () => {
    const gateway = createDeterministicAiGateway();
    const result = await gateway.generateSubjectLines({ campaignTitle: "Half term ideas", bodyPreviewText: "..." });

    expect(result.output).toHaveLength(3);
    expect(result.output.every((line) => line.includes("Half term ideas"))).toBe(true);
    expect(result.providerKey).toBe("deterministic");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("returns a template content suggestion using the campaign title", async () => {
    const gateway = createDeterministicAiGateway();
    const result = await gateway.generateContentSuggestion({ campaignTitle: "Half term ideas" });

    expect(result.output).toContain("Half term ideas");
    expect(result.providerKey).toBe("deterministic");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("returns a template campaign draft using the prompt, with only heading/text/divider blocks", async () => {
    const gateway = createDeterministicAiGateway();
    const result = await gateway.generateCampaignDraft({ prompt: "Half term ideas" });

    expect(result.output.subject).toContain("Half term ideas");
    expect(result.output.blocks.length).toBeGreaterThanOrEqual(3);
    expect(result.output.blocks.every((block) => ["heading", "text", "divider"].includes(block.type))).toBe(true);
    expect(result.providerKey).toBe("deterministic");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});

describe("createAnthropicAiGateway", () => {
  it("throws without an API key", () => {
    expect(() => createAnthropicAiGateway({ apiKey: "" })).toThrow("requires an API key");
  });

  it("parses a clean JSON array response into subject line suggestions", async () => {
    const client = fakeClient('["Half term is here!", "Book your spot", "This week: half term fun"]', { input_tokens: 150, output_tokens: 22 });
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateSubjectLines({ campaignTitle: "Half term ideas", bodyPreviewText: "Come along" });

    expect(result.output).toEqual(["Half term is here!", "Book your spot", "This week: half term fun"]);
    expect(result.providerKey).toBe("anthropic");
    expect(result.modelReference).toBe("claude-haiku-4-5-20251001");
    expect(result.usage).toEqual({ inputTokens: 150, outputTokens: 22 });
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        messages: [expect.objectContaining({ role: "user" })]
      })
    );
  });

  it("falls back to line-based parsing when the model doesn't return clean JSON", async () => {
    const client = fakeClient("1. Half term is here!\n2. Book your spot\n- This week: half term fun");
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateSubjectLines({ campaignTitle: "Half term ideas", bodyPreviewText: "Come along" });

    expect(result.output).toEqual(["Half term is here!", "Book your spot", "This week: half term fun"]);
  });

  it("uses a custom model reference when provided", async () => {
    const client = fakeClient("[]");
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", model: "claude-sonnet-5", client });

    const result = await gateway.generateSubjectLines({ campaignTitle: "x", bodyPreviewText: "y" });

    expect(result.modelReference).toBe("claude-sonnet-5");
  });

  it("returns trimmed plain-text content suggestions", async () => {
    const client = fakeClient("  Come and join us this weekend for family fun.  ");
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateContentSuggestion({ campaignTitle: "Half term ideas" });

    expect(result.output).toBe("Come and join us this weekend for family fun.");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40 });
  });

  it("parses a clean campaign-draft JSON response into subject + blocks", async () => {
    const client = fakeClient(
      JSON.stringify({
        subject: "Half term is here!",
        blocks: [
          { type: "heading", text: "Half term ideas", level: 1 },
          { type: "text", html: "<p>Come and join us this week.</p>" },
          { type: "divider" }
        ]
      }),
      { input_tokens: 200, output_tokens: 90 }
    );
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateCampaignDraft({ prompt: "Half term ideas at the local park" });

    expect(result.output).toEqual({
      subject: "Half term is here!",
      blocks: [
        { type: "heading", text: "Half term ideas", level: 1 },
        { type: "text", html: "<p>Come and join us this week.</p>" },
        { type: "divider" }
      ]
    });
    expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 90 });
  });

  it("drops an unrecognised or malformed block rather than throwing", async () => {
    const client = fakeClient(
      JSON.stringify({
        subject: "Test",
        blocks: [
          { type: "heading", text: "Fine", level: 1 },
          { type: "image", src: "https://example.test/x.png" },
          { type: "heading", text: "Missing level" },
          "not even an object",
          { type: "divider" }
        ]
      })
    );
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateCampaignDraft({ prompt: "Test" });

    expect(result.output.blocks).toEqual([
      { type: "heading", text: "Fine", level: 1 },
      { type: "divider" }
    ]);
  });

  it("returns an empty draft rather than throwing when the model's response isn't valid JSON", async () => {
    const client = fakeClient("not json at all");
    const gateway = createAnthropicAiGateway({ apiKey: "test-key", client });

    const result = await gateway.generateCampaignDraft({ prompt: "Test" });

    expect(result.output).toEqual({ subject: "", blocks: [] });
  });
});

describe("createAiGatewayFromEnv", () => {
  it("returns undefined when AI_PROVIDER is unset (graceful no-AI-configured state)", () => {
    expect(createAiGatewayFromEnv({})).toBeUndefined();
  });

  it("returns undefined when AI_PROVIDER is explicitly none", () => {
    expect(createAiGatewayFromEnv({ AI_PROVIDER: "none" })).toBeUndefined();
  });

  it("builds the no-cost deterministic gateway when AI_PROVIDER=deterministic", async () => {
    const gateway = createAiGatewayFromEnv({ AI_PROVIDER: "deterministic" });
    expect(gateway?.key).toBe("deterministic");
    const result = await gateway?.generateSubjectLines({ campaignTitle: "Test", bodyPreviewText: "..." });
    expect(result?.output).toHaveLength(3);
  });

  it("throws a clear error when AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing", () => {
    expect(() => createAiGatewayFromEnv({ AI_PROVIDER: "anthropic" })).toThrow("requires ANTHROPIC_API_KEY");
  });

  it("throws for an unsupported provider", () => {
    expect(() => createAiGatewayFromEnv({ AI_PROVIDER: "openai" })).toThrow("Unsupported AI provider");
  });

  it("builds a real gateway when AI_PROVIDER=anthropic and a key is present", () => {
    const gateway = createAiGatewayFromEnv({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key" });
    expect(gateway?.key).toBe("anthropic");
  });
});

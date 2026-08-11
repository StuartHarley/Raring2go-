import { describe, expect, it } from "vitest";
import { createDevelopmentEditorialAIProvider } from "./ai";

describe("editorial AI provider contract", () => {
  it("keeps generated editorial output provider-neutral and approval-gated", async () => {
    const provider = createDevelopmentEditorialAIProvider();

    const result = await provider.generate({
      kind: "headline",
      editionId: "edition_1",
      territoryId: "territory_1",
      prompt: "Write a warm family days-out headline."
    });

    expect(result).toMatchObject({
      providerKey: "development-editorial-ai",
      kind: "headline",
      approvalRequired: true,
      attribution: {
        actorType: "ai",
        providerKey: "development-editorial-ai",
        model: "deterministic-test"
      }
    });
  });
});

import { fixtureIds } from "@raring2go/db";
import { describe, expect, it, vi } from "vitest";

// A "real" (non-deterministic) provider with no events workflow configured. The factory is
// mocked because the vendor SDK refuses to construct in the jsdom test environment.
const complete = vi.fn();
vi.mock("@raring2go/ai", async (importOriginal) => {
  const original = await importOriginal<typeof import("@raring2go/ai")>();
  return { ...original, createAiProviderFromEnv: () => ({ key: "anthropic", deterministic: false, complete }), createExternalWorkflowsFromEnv: () => ({}) };
});

const { discoverEvents } = await import("./publishing-runtime");

describe("event discovery without its workflow", () => {
  it("refuses to invent events: rejected up front, no model call, nothing recorded", async () => {
    const hq = { userId: fixtureIds.users.superAdmin, organisationId: fixtureIds.organisations.hq };
    const from = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    await expect(discoverEvents(hq, { territoryId: fixtureIds.territories.suttonColdfield, from, to })).rejects.toThrow(/needs its workflow configured/);
    expect(complete).not.toHaveBeenCalled();
  });
});

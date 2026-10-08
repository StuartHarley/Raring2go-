import { describe, expect, it, vi } from "vitest";
import { boundForStorage } from "./bounds";
import { estimateCostMinor } from "./pricing";
import { createDeterministicProvider } from "./provider";
import type { AiProvider } from "./provider";
import { AiRunFailedError, runAiTask } from "./runner";
import { createInMemoryAiRunStore } from "./runs";
import { AiNotConfiguredError, AiOutputError, defineAiTask, requiresReview } from "./task";

type Input = { title: string; apiKey?: string; notes?: string };
type Output = { text: string };

const task = defineAiTask<Input, Output>({
  key: "content.draft",
  promptVersion: "content-draft.v1",
  purpose: "Draft article copy from a brief",
  risk: "low",
  approval: "review",
  capability: { module: "content", action: "ai_generate" },
  maxTokens: 500,
  system: "You write copy.",
  buildUserPrompt: (input) => `Title: ${input.title}`,
  parse: (text) => {
    if (!text.trim()) throw new AiOutputError("The AI returned an empty draft.");
    return { text: text.trim() };
  },
  deterministic: (input) => ({ text: `Draft for ${input.title}` }),
  summariseInput: (input) => ({ title: input.title, apiKey: input.apiKey, notes: input.notes }),
  sources: (input) => [{ type: "content_item", id: "c-1", label: input.title }]
});

const actor = { type: "human" as const, userId: "u1" };
const scope = { organisationId: "org-1", territoryId: "t-1" };
const fixedNow = () => new Date("2026-03-01T00:00:00Z");

function modelProvider(text: string, usage = { inputTokens: 200, outputTokens: 80 }): AiProvider {
  return { key: "anthropic", deterministic: false, complete: vi.fn(async () => ({ text, usage, modelReference: "claude-haiku-4-5-20251001" })) };
}

describe("runAiTask", () => {
  it("records actor, purpose, sources, bounded input, output, model, usage and approval state", async () => {
    const store = createInMemoryAiRunStore();
    const audit = { record: vi.fn(async () => undefined) };
    const { run, output } = await runAiTask({ provider: modelProvider("  Hello world  "), store, audit, now: fixedNow }, task, {
      input: { title: "Half term", apiKey: "sk-live-secret", notes: "x".repeat(5000) },
      actor,
      scope,
      subject: { type: "content_item", id: "c-1" }
    });

    expect(output).toEqual({ text: "Hello world" });
    expect(run).toMatchObject({
      taskKey: "content.draft",
      purpose: "Draft article copy from a brief",
      promptVersion: "content-draft.v1",
      providerKey: "anthropic",
      modelReference: "claude-haiku-4-5-20251001",
      status: "succeeded",
      approvalState: "pending",
      actorType: "human",
      actorUserId: "u1",
      territoryId: "t-1",
      subjectType: "content_item",
      subjectId: "c-1",
      inputTokens: 200,
      outputTokens: 80,
      sourceRefs: [{ type: "content_item", id: "c-1", label: "Half term" }]
    });
    expect(run.estimatedCostMinor).toBe(estimateCostMinor("claude-haiku-4-5-20251001", { inputTokens: 200, outputTokens: 80 }));
    // Secrets never reach the run; long text is truncated.
    expect(JSON.stringify(run.input)).not.toContain("sk-live-secret");
    expect(String(run.input.notes).length).toBeLessThan(2_100);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.generate", actor: expect.objectContaining({ type: "ai", mode: "suggested", runId: run.id }), metadata: expect.objectContaining({ requestedBy: "u1", approvalState: "pending" }) })
    );
  });

  it("uses the task's template output with no model call and zero usage for the deterministic provider", async () => {
    const store = createInMemoryAiRunStore();
    const { run, output } = await runAiTask({ provider: createDeterministicProvider(), store, now: fixedNow }, task, { input: { title: "Half term" }, actor, scope });
    expect(output).toEqual({ text: "Draft for Half term" });
    expect(run).toMatchObject({ providerKey: "deterministic", modelReference: "deterministic-content.draft", inputTokens: 0, estimatedCostMinor: 0 });
  });

  it("not_required for informational tasks, always pending for high-risk ones even if they ask for none", async () => {
    const info = defineAiTask<Input, Output>({ ...task, key: "content.summary", approval: "none" });
    const risky = defineAiTask<Input, Output>({ ...task, key: "finance.anomaly", risk: "high", approval: "none" });
    expect(requiresReview(info)).toBe(false);
    expect(requiresReview(risky)).toBe(true);

    const store = createInMemoryAiRunStore();
    const deps = { provider: createDeterministicProvider(), store, now: fixedNow };
    expect((await runAiTask(deps, info, { input: { title: "x" }, actor, scope })).run.approvalState).toBe("not_required");
    expect((await runAiTask(deps, risky, { input: { title: "x" }, actor, scope })).run.approvalState).toBe("pending");
  });

  it("records a failed run for unusable output and surfaces only a safe message", async () => {
    const store = createInMemoryAiRunStore();
    await expect(runAiTask({ provider: modelProvider("   "), store, now: fixedNow }, task, { input: { title: "x" }, actor, scope })).rejects.toMatchObject({ message: "The AI returned an empty draft." });
    const [failed] = [...store.runs.values()];
    // The model did reply (tokens were spent), so the failed run keeps the real usage and cost.
    expect(failed).toMatchObject({ status: "failed", approvalState: "not_required", output: {}, inputTokens: 200, outputTokens: 80 });
    expect(failed!.estimatedCostMinor).toBeGreaterThan(0);
  });

  it("hides provider/network detail behind a safe message but keeps it on the failed run", async () => {
    const store = createInMemoryAiRunStore();
    const broken: AiProvider = { key: "anthropic", deterministic: false, complete: async () => { throw new Error("401 invalid x-api-key sk-ant-123"); } };
    const error = await runAiTask({ provider: broken, store, now: fixedNow }, task, { input: { title: "x" }, actor, scope }).catch((caught) => caught);
    expect(error).toBeInstanceOf(AiRunFailedError);
    expect(error.message).not.toContain("sk-ant");
    expect(error.runId).toBe([...store.runs.values()][0]!.id);
  });

  it("a blocked guard (rate limit or spend cap) stops the call and records nothing", async () => {
    const store = createInMemoryAiRunStore();
    const provider = modelProvider("hi");
    await expect(runAiTask({ provider, store, guard: async () => { throw new Error("AI spend limit reached"); }, now: fixedNow }, task, { input: { title: "x" }, actor, scope })).rejects.toThrow("spend limit");
    expect(provider.complete).not.toHaveBeenCalled();
    expect(store.runs.size).toBe(0);
  });

  it("records automation as the actor without a user id", async () => {
    const store = createInMemoryAiRunStore();
    const { run } = await runAiTask({ provider: createDeterministicProvider(), store, now: fixedNow }, task, { input: { title: "x" }, actor: { type: "automation", automationId: "workflow-engine" }, scope });
    expect(run).toMatchObject({ actorType: "automation", actorUserId: null });
  });
});

describe("externalOnly tasks", () => {
  const ext = defineAiTask<Input, Output>({ ...task, key: "events.discover", externalOnly: true, fromStructured: (raw) => ({ text: String((raw as { text?: unknown }).text ?? "") }), structuredInput: (input) => ({ title: input.title }) });

  it("refuse a real model without the external workflow, before the guard or any provider call", async () => {
    const store = createInMemoryAiRunStore();
    const provider = modelProvider("made up events");
    const guard = vi.fn(async () => undefined);
    await expect(runAiTask({ provider, store, guard, now: fixedNow }, ext, { input: { title: "x" }, actor, scope })).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(guard).not.toHaveBeenCalled();
    expect(store.runs.size).toBe(0);
  });

  it("run through the external workflow when configured, and via the deterministic provider in development", async () => {
    const store = createInMemoryAiRunStore();
    const workflows = { "events.discover": { taskKey: "events.discover", run: async () => ({ output: { text: "found" }, modelReference: "wf", usage: { inputTokens: 1, outputTokens: 1 } }) } };
    expect((await runAiTask({ provider: modelProvider("x"), workflows, store, now: fixedNow }, ext, { input: { title: "x" }, actor, scope })).output).toEqual({ text: "found" });
    expect((await runAiTask({ provider: createDeterministicProvider(), store, now: fixedNow }, ext, { input: { title: "x" }, actor, scope })).run.providerKey).toBe("deterministic");
  });
});

describe("defineAiTask / boundForStorage", () => {
  it("rejects malformed task definitions", () => {
    expect(() => defineAiTask({ ...task, key: "BadKey" })).toThrow(/dot-case/);
    expect(() => defineAiTask({ ...task, maxTokens: 0 })).toThrow(/maxTokens/);
    expect(() => defineAiTask({ ...task, purpose: " " })).toThrow(/purpose/);
  });

  it("bounds depth, list length and string length", () => {
    const deep = boundForStorage({ a: { b: { c: { d: { e: "too deep" } } } }, list: Array.from({ length: 200 }, (_, i) => i) });
    expect(JSON.stringify(deep)).not.toContain("too deep");
    expect((deep.list as unknown[]).length).toBe(50);
  });
});

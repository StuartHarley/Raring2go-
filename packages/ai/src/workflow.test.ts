import { describe, expect, it, vi } from "vitest";
import { createInMemoryAiRunStore } from "./runs";
import { createDeterministicProvider } from "./provider";
import { runAiTask } from "./runner";
import { AiOutputError, defineAiTask } from "./task";
import { createExternalWorkflowsFromEnv, createHttpExternalWorkflow, ExternalWorkflowError, workflowEnvPrefix } from "./workflow";

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe("createHttpExternalWorkflow", () => {
  it("posts the task key and structured input with a bearer token and returns validated-by-the-task output", async () => {
    const fetchImpl = vi.fn(async () => json({ output: { title: "T" }, model: "gpt-x", usage: { inputTokens: 10, outputTokens: 4 } }));
    const workflow = createHttpExternalWorkflow({ taskKey: "content.draft", url: "https://example.test/run", token: "tok", fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await workflow.run({ brief: "x" });
    expect(result).toEqual({ output: { title: "T" }, modelReference: "gpt-x", usage: { inputTokens: 10, outputTokens: 4 } });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer tok" });
    expect(JSON.parse(String(init.body))).toEqual({ task: "content.draft", input: { brief: "x" } });
    expect(init.redirect).toBe("error");
  });

  it("refuses non-https endpoints except localhost", () => {
    expect(() => createHttpExternalWorkflow({ taskKey: "a.b", url: "http://example.test/run" })).toThrow(/https/);
    expect(() => createHttpExternalWorkflow({ taskKey: "a.b", url: "http://localhost:9000/run" })).not.toThrow();
  });

  it("reports HTTP status only, never the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret token echoed: abc123", { status: 502 }));
    const workflow = createHttpExternalWorkflow({ taskKey: "content.draft", url: "https://example.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    const error = await workflow.run({}).catch((caught) => caught);
    expect(error).toBeInstanceOf(ExternalWorkflowError);
    expect(error.message).toContain("HTTP 502");
    expect(error.message).not.toContain("abc123");
  });

  it("maps non-JSON, oversize, network and timeout failures to safe errors", async () => {
    const make = (impl: () => Promise<Response>, timeoutMs?: number) => createHttpExternalWorkflow({ taskKey: "a.b", url: "https://example.test", timeoutMs, fetchImpl: vi.fn(impl) as unknown as typeof fetch });
    await expect(make(async () => new Response("<html>")).run({})).rejects.toThrow(/did not return JSON/);
    await expect(make(async () => new Response("x".repeat(300_000))).run({})).rejects.toThrow(/too large/);
    await expect(make(async () => { throw new Error("ECONNREFUSED 10.0.0.5"); }).run({})).rejects.toThrow(/could not be reached/);
    const abortable = createHttpExternalWorkflow({
      taskKey: "a.b",
      url: "https://example.test",
      timeoutMs: 10,
      fetchImpl: ((_url: unknown, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as unknown as typeof fetch
    });
    await expect(abortable.run({})).rejects.toThrow(/timed out/);
  });

  it("defaults unusable model and usage fields instead of trusting them", async () => {
    const workflow = createHttpExternalWorkflow({ taskKey: "a.b", url: "https://example.test", fetchImpl: (async () => json({ output: {}, model: 5, usage: { inputTokens: "lots" } })) as unknown as typeof fetch });
    expect(await workflow.run({})).toMatchObject({ modelReference: "external:a.b", usage: { inputTokens: 0, outputTokens: 0 } });
  });
});

describe("createExternalWorkflowsFromEnv", () => {
  it("builds workflows only for tasks that have a URL configured", () => {
    expect(workflowEnvPrefix("events.discover")).toBe("AI_WORKFLOW_EVENTS_DISCOVER");
    const workflows = createExternalWorkflowsFromEnv(["content.draft", "events.discover"], { AI_WORKFLOW_CONTENT_DRAFT_URL: "https://example.test/c", AI_WORKFLOW_CONTENT_DRAFT_TOKEN: "t" });
    expect(Object.keys(workflows)).toEqual(["content.draft"]);
  });
});

describe("runAiTask with an external workflow", () => {
  type In = { brief: string };
  type Out = { title: string };
  const task = defineAiTask<In, Out>({
    key: "content.draft", promptVersion: "v1", purpose: "Draft", risk: "low", approval: "review", capability: { module: "content.ai", action: "generate" }, maxTokens: 100, system: "s",
    buildUserPrompt: () => "built-in prompt must not be used", parse: () => { throw new Error("built-in parse must not be used"); },
    deterministic: () => ({ title: "d" }), summariseInput: (input) => ({ brief: input.brief }),
    structuredInput: (input) => ({ brief: input.brief }),
    fromStructured: (raw) => {
      if (!raw || typeof raw !== "object" || typeof (raw as { title?: unknown }).title !== "string") throw new AiOutputError("The workflow returned a draft without a title.");
      return { title: (raw as { title: string }).title };
    }
  });
  const actor = { type: "human" as const, userId: "u1" };

  it("routes to the workflow instead of the built-in prompt and records it as the provider", async () => {
    const store = createInMemoryAiRunStore();
    const provider = { ...createDeterministicProvider(), deterministic: false, complete: vi.fn() };
    const workflows = { "content.draft": { taskKey: "content.draft", run: vi.fn(async () => ({ output: { title: "From GPT" }, modelReference: "gpt-4o", usage: { inputTokens: 50, outputTokens: 20 } })) } };
    const { run, output } = await runAiTask({ provider, workflows, store }, task, { input: { brief: "b" }, actor, scope: {} });
    expect(output).toEqual({ title: "From GPT" });
    expect(provider.complete).not.toHaveBeenCalled();
    expect(workflows["content.draft"].run).toHaveBeenCalledWith({ brief: "b" });
    expect(run).toMatchObject({ providerKey: "external_workflow", modelReference: "gpt-4o", inputTokens: 50, approvalState: "pending" });
  });

  it("records a failed run and surfaces a safe message when the workflow output is unusable", async () => {
    const store = createInMemoryAiRunStore();
    const workflows = { "content.draft": { taskKey: "content.draft", run: async () => ({ output: { nope: 1 }, modelReference: "gpt", usage: { inputTokens: 0, outputTokens: 0 } }) } };
    await expect(runAiTask({ provider: createDeterministicProvider(), workflows, store }, task, { input: { brief: "b" }, actor, scope: {} })).rejects.toThrow("without a title");
    expect([...store.runs.values()][0]).toMatchObject({ status: "failed", providerKey: "external_workflow" });
  });

  it("surfaces workflow transport errors by status only", async () => {
    const store = createInMemoryAiRunStore();
    const workflows = { "content.draft": { taskKey: "content.draft", run: async () => { throw new ExternalWorkflowError("The content.draft workflow responded with HTTP 503."); } } };
    await expect(runAiTask({ provider: createDeterministicProvider(), workflows, store }, task, { input: { brief: "b" }, actor, scope: {} })).rejects.toThrow("HTTP 503");
  });

  it("refuses to route a task that cannot validate structured output", async () => {
    const plain = defineAiTask<In, Out>({ ...task, fromStructured: undefined });
    const store = createInMemoryAiRunStore();
    const workflows = { "content.draft": { taskKey: "content.draft", run: vi.fn() } };
    await expect(runAiTask({ provider: createDeterministicProvider(), workflows, store }, plain, { input: { brief: "b" }, actor, scope: {} })).rejects.toThrow();
    expect(workflows["content.draft"].run).not.toHaveBeenCalled();
  });
});

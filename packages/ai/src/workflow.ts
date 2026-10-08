import type { AiUsage } from "./gateway";

/**
 * An existing Raring2go AI workflow (e.g. the content-creation or events-finding GPT)
 * exposed as an HTTP service. The platform sends structured input and receives structured
 * output; the prompts stay wherever that workflow lives (AGENTS.md: adapters, not copied
 * into UI prompts). The response is validated by the task like any other model output.
 */
export type ExternalWorkflow = {
  taskKey: string;
  run(input: Record<string, unknown>): Promise<{ output: unknown; modelReference: string; usage: AiUsage }>;
};

export class ExternalWorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalWorkflowError";
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 256_000;

export function createHttpExternalWorkflow(config: {
  taskKey: string;
  url: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): ExternalWorkflow {
  const url = new URL(config.url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new ExternalWorkflowError("External AI workflows must use https (http is only allowed for localhost).");
  }
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    taskKey: config.taskKey,
    async run(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(config.token ? { authorization: `Bearer ${config.token}` } : {}) },
          body: JSON.stringify({ task: config.taskKey, input }),
          signal: controller.signal,
          redirect: "error"
        });

        // Status only: the body of an error response may echo credentials or prompts.
        if (!response.ok) {
          throw new ExternalWorkflowError(`The ${config.taskKey} workflow responded with HTTP ${response.status}.`);
        }
        const text = await response.text();
        if (text.length > MAX_RESPONSE_BYTES) {
          throw new ExternalWorkflowError(`The ${config.taskKey} workflow response was too large.`);
        }

        let body: { output?: unknown; model?: unknown; usage?: { inputTokens?: unknown; outputTokens?: unknown } };
        try {
          body = JSON.parse(text);
        } catch {
          throw new ExternalWorkflowError(`The ${config.taskKey} workflow did not return JSON.`);
        }

        return {
          output: body.output,
          modelReference: typeof body.model === "string" && body.model ? body.model.slice(0, 100) : `external:${config.taskKey}`,
          usage: {
            inputTokens: Number.isInteger(body.usage?.inputTokens) ? (body.usage!.inputTokens as number) : 0,
            outputTokens: Number.isInteger(body.usage?.outputTokens) ? (body.usage!.outputTokens as number) : 0
          }
        };
      } catch (error) {
        if (error instanceof ExternalWorkflowError) throw error;
        if (error instanceof Error && error.name === "AbortError") {
          throw new ExternalWorkflowError(`The ${config.taskKey} workflow timed out.`);
        }
        throw new ExternalWorkflowError(`The ${config.taskKey} workflow could not be reached.`);
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

/** `content.draft` -> `AI_WORKFLOW_CONTENT_DRAFT_URL` / `AI_WORKFLOW_CONTENT_DRAFT_TOKEN`. */
export function workflowEnvPrefix(taskKey: string) {
  return `AI_WORKFLOW_${taskKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

export function createExternalWorkflowsFromEnv(taskKeys: string[], source: NodeJS.ProcessEnv = process.env): Record<string, ExternalWorkflow> {
  const workflows: Record<string, ExternalWorkflow> = {};

  for (const taskKey of taskKeys) {
    const prefix = workflowEnvPrefix(taskKey);
    const url = source[`${prefix}_URL`];
    if (url) {
      workflows[taskKey] = createHttpExternalWorkflow({ taskKey, url, token: source[`${prefix}_TOKEN`] });
    }
  }

  return workflows;
}

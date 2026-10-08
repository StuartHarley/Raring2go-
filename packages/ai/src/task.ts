/** A record or URL the model was given. References only: never copy record bodies into a run. */
export type AiSourceRef = {
  type: string;
  id?: string;
  url?: string;
  label?: string;
};

/** Raised by a task's `parse` when the model's reply is unusable; the run is recorded as failed. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

export type AiTaskRisk = "low" | "high";

/**
 * One kind of AI work. This is the unit AGENTS.md means by "integrate through
 * adapters": the prompt, parsing and fallback live here, never in UI code.
 */
export type AiTask<Input, Output extends Record<string, unknown>> = {
  /** Dot-case, e.g. "content.draft". Stored on every run. */
  key: string;
  /** Bump when the prompt or parsing changes so runs stay comparable. */
  promptVersion: string;
  /** Plain-English purpose, shown in the runs list and audit trail. */
  purpose: string;
  /**
   * `high` = legal, financial, compliance or publication-affecting output. Always needs
   * a human decision (four-eyes: not the requester) before it may be used.
   */
  risk: AiTaskRisk;
  /**
   * `review` = the output is a suggestion a human must accept or reject; `none` =
   * informational only. High-risk tasks are always treated as `review`.
   */
  approval: "none" | "review";
  /** Permission needed to run it; checked by the caller's runtime against its permission data. */
  capability: { module: string; action: string };
  maxTokens: number;
  system: string;
  buildUserPrompt(input: Input): string;
  parse(text: string, input: Input): Output;
  /** Template output used when no model is configured (tests, development). */
  deterministic(input: Input): Output;
  /** Bounded, secret-free summary of the input to store with the run. */
  summariseInput(input: Input): Record<string, unknown>;
  sources?(input: Input): AiSourceRef[];
};

const taskKeyPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export function defineAiTask<Input, Output extends Record<string, unknown>>(task: AiTask<Input, Output>): AiTask<Input, Output> {
  if (!taskKeyPattern.test(task.key)) {
    throw new Error(`AI task key "${task.key}" must be dot-case, e.g. "content.draft".`);
  }
  if (!task.promptVersion.trim() || !task.purpose.trim()) {
    throw new Error(`AI task "${task.key}" needs a prompt version and a purpose.`);
  }
  if (task.maxTokens < 1 || task.maxTokens > 8000) {
    throw new Error(`AI task "${task.key}" needs maxTokens between 1 and 8000.`);
  }
  return task;
}

/** High-risk tasks cannot opt out of human review. */
export function requiresReview(task: Pick<AiTask<never, never>, "risk" | "approval">) {
  return task.risk === "high" || task.approval === "review";
}

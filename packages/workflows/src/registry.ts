import type { JobHandler } from "./types";

export type JobRegistry = {
  get(kind: string): JobHandler | undefined;
  kinds(): string[];
  require(kind: string): JobHandler;
};

export const defaultHandlerSettings = {
  maxAttempts: 5,
  baseBackoffMs: 30_000,
  maxBackoffMs: 30 * 60_000,
  leaseMs: 5 * 60_000
} as const;

export function defineJobHandler(
  handler: Pick<JobHandler, "kind" | "handle"> & Partial<Omit<JobHandler, "kind" | "handle">>
): JobHandler {
  const resolved: JobHandler = { ...defaultHandlerSettings, ...handler };

  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(resolved.kind)) {
    throw new Error(`Job kind "${resolved.kind}" must be dot-case, e.g. "publishing.generate_output".`);
  }
  if (resolved.maxAttempts < 1) {
    throw new Error(`Job kind "${resolved.kind}" needs maxAttempts >= 1.`);
  }
  if (resolved.baseBackoffMs < 0 || resolved.maxBackoffMs < resolved.baseBackoffMs) {
    throw new Error(`Job kind "${resolved.kind}" has an invalid backoff range.`);
  }
  if (resolved.leaseMs < 1_000) {
    throw new Error(`Job kind "${resolved.kind}" needs a lease of at least one second.`);
  }

  return resolved;
}

export function createJobRegistry(handlers: JobHandler[]): JobRegistry {
  const byKind = new Map<string, JobHandler>();

  for (const handler of handlers) {
    if (byKind.has(handler.kind)) {
      throw new Error(`Duplicate job handler for kind "${handler.kind}".`);
    }
    byKind.set(handler.kind, handler);
  }

  return {
    get: (kind) => byKind.get(kind),
    kinds: () => [...byKind.keys()],
    require(kind) {
      const handler = byKind.get(kind);
      if (!handler) {
        throw new Error(`No job handler registered for kind "${kind}".`);
      }
      return handler;
    }
  };
}

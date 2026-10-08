export const jobCapabilities = {
  view: { module: "system.jobs", action: "view" },
  retry: { module: "system.jobs", action: "retry" },
  cancel: { module: "system.jobs", action: "cancel" }
} as const;

export type JobCapability = keyof typeof jobCapabilities;

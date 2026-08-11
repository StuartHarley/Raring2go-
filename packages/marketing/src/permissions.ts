export const marketingCapabilities = {
  audienceView: { module: "marketing.audience", action: "view" },
  audienceManage: { module: "marketing.audience", action: "manage" },
  consentManage: { module: "marketing.consent", action: "manage" },
  segmentView: { module: "marketing.segment", action: "view" },
  segmentManage: { module: "marketing.segment", action: "manage" },
  importManage: { module: "marketing.import", action: "manage" }
} as const;

export type MarketingCapability = keyof typeof marketingCapabilities;

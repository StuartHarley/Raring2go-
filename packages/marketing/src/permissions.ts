export const marketingCapabilities = {
  audienceView: { module: "marketing.audience", action: "view" },
  audienceManage: { module: "marketing.audience", action: "manage" },
  consentManage: { module: "marketing.consent", action: "manage" },
  segmentView: { module: "marketing.segment", action: "view" },
  segmentManage: { module: "marketing.segment", action: "manage" },
  importManage: { module: "marketing.import", action: "manage" },
  emailView: { module: "marketing.email", action: "view" },
  emailCreate: { module: "marketing.email", action: "create" },
  emailApprove: { module: "marketing.email", action: "approve" },
  emailSchedule: { module: "marketing.email", action: "schedule" },
  emailSend: { module: "marketing.email", action: "send" },
  emailRecordDelivery: { module: "marketing.email", action: "record_delivery" },
  newsletterFactoryView: { module: "marketing.newsletter_factory", action: "view" },
  newsletterFactoryManage: { module: "marketing.newsletter_factory", action: "manage" },
  newsletterFactoryApprove: { module: "marketing.newsletter_factory", action: "approve" },
  newsletterFactoryContribute: { module: "marketing.newsletter_factory", action: "contribute" },
  journeyView: { module: "marketing.journey", action: "view" },
  journeyCreate: { module: "marketing.journey", action: "create" },
  journeyEdit: { module: "marketing.journey", action: "edit" },
  journeyApprove: { module: "marketing.journey", action: "approve" },
  journeyActivate: { module: "marketing.journey", action: "activate" },
  journeyPause: { module: "marketing.journey", action: "pause" },
  journeyExecute: { module: "marketing.journey", action: "execute" }
} as const;

export type MarketingCapability = keyof typeof marketingCapabilities;

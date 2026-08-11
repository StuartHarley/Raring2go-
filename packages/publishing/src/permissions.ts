export const publishingCapabilities = {
  editionView: { module: "edition", action: "view" },
  editionCreate: { module: "edition", action: "create" },
  editionEdit: { module: "edition", action: "edit" },
  editionApprove: { module: "edition", action: "approve" },
  editionRelease: { module: "edition", action: "release" },
  templateCreate: { module: "edition.template", action: "create" },
  templateEdit: { module: "edition.template", action: "edit" },
  templateApprove: { module: "edition.template", action: "approve" },
  templatePublish: { module: "edition.template", action: "publish" },
  pageEdit: { module: "edition.page", action: "edit" },
  localContentEdit: { module: "edition.content", action: "edit_local" },
  lockedContentManage: { module: "edition.content", action: "manage_locked" },
  preflightOverride: { module: "edition.preflight", action: "override" },
  generatePrint: { module: "edition.output", action: "generate_print" },
  generateDigital: { module: "edition.output", action: "generate_digital" },
  contentView: { module: "content", action: "view" },
  contentCreate: { module: "content", action: "create" },
  contentEdit: { module: "content", action: "edit" },
  contentApprove: { module: "content", action: "approve" },
  contentLocalise: { module: "content", action: "localise" },
  contentDistributeNetwork: { module: "content", action: "distribute_network" },
  contentAiGenerate: { module: "content.ai", action: "generate" },
  contentAiApprove: { module: "content.ai", action: "approve" },
  contentWebsitePublish: { module: "content.website", action: "publish" }
} as const;

export type PublishingCapability = keyof typeof publishingCapabilities;

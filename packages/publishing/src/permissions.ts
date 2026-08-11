export const publishingCapabilities = {
  editionView: { module: "edition", action: "view" },
  editionCreate: { module: "edition", action: "create" },
  editionEdit: { module: "edition", action: "edit" },
  editionApprove: { module: "edition", action: "approve" },
  editionRelease: { module: "edition", action: "release" },
  templateCreate: { module: "edition.template", action: "create" },
  templateEdit: { module: "edition.template", action: "edit" },
  templateApprove: { module: "edition.template", action: "approve" },
  templatePublish: { module: "edition.template", action: "publish" }
} as const;

export type PublishingCapability = keyof typeof publishingCapabilities;

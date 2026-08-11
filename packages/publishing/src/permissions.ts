export const publishingCapabilities = {
  editionView: { module: "edition", action: "view" },
  editionCreate: { module: "edition", action: "create" },
  editionEdit: { module: "edition", action: "edit" },
  editionApprove: { module: "edition", action: "approve" },
  editionRelease: { module: "edition", action: "release" }
} as const;

export type PublishingCapability = keyof typeof publishingCapabilities;

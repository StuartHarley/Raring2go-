export const filesCapabilities = {
  upload: { module: "files", action: "upload" }
} as const;

export type FilesCapability = keyof typeof filesCapabilities;

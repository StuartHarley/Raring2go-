import type { PermissionDecision, PermissionRequest } from "./types";

export type PermissionCache = {
  get(request: PermissionRequest): Promise<PermissionDecision | undefined>;
  set(request: PermissionRequest, decision: PermissionDecision): Promise<void>;
  invalidateUser(userId: string): Promise<void>;
  invalidateOrganisation(organisationId: string): Promise<void>;
};

export const noPermissionCache: PermissionCache = {
  async get() {
    return undefined;
  },
  async set() {},
  async invalidateUser() {},
  async invalidateOrganisation() {}
};

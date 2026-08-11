export const advertisingCapabilities = {
  view: { module: "advertiser", action: "view" },
  create: { module: "advertiser", action: "create" },
  edit: { module: "advertiser", action: "edit" },
  contactManage: { module: "advertiser.contact", action: "manage" },
  activityRecord: { module: "advertiser.activity", action: "record" }
} as const;

export type AdvertisingCapability = keyof typeof advertisingCapabilities;

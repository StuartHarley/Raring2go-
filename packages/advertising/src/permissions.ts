export const advertisingCapabilities = {
  view: { module: "advertiser", action: "view" },
  create: { module: "advertiser", action: "create" },
  edit: { module: "advertiser", action: "edit" },
  contactManage: { module: "advertiser.contact", action: "manage" },
  activityRecord: { module: "advertiser.activity", action: "record" },
  opportunityView: { module: "advertiser.opportunity", action: "view" },
  opportunityCreate: { module: "advertiser.opportunity", action: "create" },
  opportunityEdit: { module: "advertiser.opportunity", action: "edit" }
} as const;

export type AdvertisingCapability = keyof typeof advertisingCapabilities;

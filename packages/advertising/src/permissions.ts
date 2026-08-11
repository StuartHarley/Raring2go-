export const advertisingCapabilities = {
  view: { module: "advertiser", action: "view" },
  create: { module: "advertiser", action: "create" },
  edit: { module: "advertiser", action: "edit" },
  contactManage: { module: "advertiser.contact", action: "manage" },
  activityRecord: { module: "advertiser.activity", action: "record" },
  opportunityView: { module: "advertiser.opportunity", action: "view" },
  opportunityCreate: { module: "advertiser.opportunity", action: "create" },
  opportunityEdit: { module: "advertiser.opportunity", action: "edit" },
  catalogueView: { module: "advertiser.catalogue", action: "view" },
  pricingManage: { module: "advertiser.pricing", action: "manage" },
  inventoryReserve: { module: "advertiser.inventory", action: "reserve" },
  proposalView: { module: "advertiser.proposal", action: "view" },
  proposalCreate: { module: "advertiser.proposal", action: "create" },
  bookingAccept: { module: "advertiser.booking", action: "accept" }
} as const;

export type AdvertisingCapability = keyof typeof advertisingCapabilities;

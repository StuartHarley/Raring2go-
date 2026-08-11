import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  createSeasonWithMasterEdition,
  approveTemplateVersion,
  createMagazineTemplate,
  createTemplateRevision,
  generateTerritoryEditions,
  listEditionSummaries,
  publishTemplateVersion
} from "./service";
import type { PublishingData } from "./types";
import type { PermissionData } from "@raring2go/permissions";

const ids = {
  users: {
    hq: "user_hq",
    local: "user_local"
  },
  organisations: {
    hq: "org_hq",
    franchise: "org_franchise",
    other: "org_other"
  },
  territories: {
    own: "territory_own",
    other: "territory_other"
  },
  roles: {
    hq: "role_hq",
    local: "role_local"
  },
  season: "season_autumn",
  master: "master_autumn",
  edition: "edition_own",
  template: "template_cover",
  templateVersion: "template_cover_v1",
  templateVersion2: "template_cover_v2"
} as const;

const permissions: PermissionData = {
  roleAssignments: [
    {
      id: "assignment_hq",
      userId: ids.users.hq,
      roleId: ids.roles.hq,
      organisationId: ids.organisations.hq
    },
    {
      id: "assignment_local",
      userId: ids.users.local,
      roleId: ids.roles.local,
      organisationId: ids.organisations.franchise,
      territoryId: ids.territories.own
    }
  ],
  rolePermissions: [
    grant(ids.roles.hq, "edition", "view", "network"),
    grant(ids.roles.hq, "edition", "create", "network"),
    grant(ids.roles.hq, "edition.template", "create", "network"),
    grant(ids.roles.hq, "edition.template", "edit", "network"),
    grant(ids.roles.hq, "edition.template", "approve", "network"),
    grant(ids.roles.hq, "edition.template", "publish", "network"),
    grant(ids.roles.local, "edition", "view", "own_territory")
  ],
  territories: [
    {
      id: ids.territories.own,
      franchiseOrganisationId: ids.organisations.franchise
    },
    {
      id: ids.territories.other,
      franchiseOrganisationId: ids.organisations.other
    }
  ]
};

describe("publishing edition model", () => {
  it("creates the canonical season and master edition with audit", async () => {
    const publishingData = emptyData();
    const recorder = audit();

    await createSeasonWithMasterEdition(hqContext(), permissions, recorder, publishingData, {
      season: season(),
      masterEdition: masterEdition()
    });

    expect(publishingData.seasons).toHaveLength(1);
    expect(publishingData.masterEditions[0]).toMatchObject({
      seasonId: ids.season,
      pageCount: 36,
      version: 1
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.publishingEditionCreate
    ]);
  });

  it("generates one territory edition per season and preserves master version", async () => {
    const publishingData = seededData();
    const created = await generateTerritoryEditions(
      hqContext(),
      permissions,
      audit(),
      publishingData,
      ids.master,
      [ids.territories.own, ids.territories.own]
    );

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      seasonId: ids.season,
      territoryId: ids.territories.own,
      pageCount: 36,
      printStatus: "not_started",
      digitalStatus: "not_started",
      generatedFromMasterVersion: 1
    });
    expect(publishingData.territoryEditions).toHaveLength(1);
  });

  it("filters territory editions by local context and blocks cross-territory leakage", async () => {
    const publishingData = seededData();
    await generateTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.master, [
      ids.territories.own,
      ids.territories.other
    ]);

    const [summary] = listEditionSummaries(
      {
        userId: ids.users.local,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissions,
      publishingData
    );

    expect(summary?.territoryEditions.map((edition) => edition.territoryId)).toEqual([
      ids.territories.own
    ]);
  });

  it("denies edition creation without capability", async () => {
    await expect(
      createSeasonWithMasterEdition(
        {
          userId: ids.users.local,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissions,
        audit(),
        emptyData(),
        {
          season: season(),
          masterEdition: masterEdition()
        }
      )
    ).rejects.toThrow("No permission grant");
  });

  it("creates approves and publishes magazine template versions immutably", async () => {
    const publishingData = emptyData();
    const recorder = audit();

    await createMagazineTemplate(hqContext(), permissions, recorder, publishingData, {
      template: template(),
      version: templateVersion()
    });
    await approveTemplateVersion(hqContext(), permissions, recorder, publishingData, ids.templateVersion);
    await publishTemplateVersion(hqContext(), permissions, recorder, publishingData, ids.templateVersion);
    await createTemplateRevision(hqContext(), permissions, recorder, publishingData, ids.template, {
      ...templateVersion(),
      id: ids.templateVersion2,
      version: 2,
      status: "draft",
      editableZones: [{ id: "local-cover-line", type: "headline", locked: false }]
    });

    expect(publishingData.magazineTemplateVersions.map((version) => ({
      id: version.id,
      status: version.status,
      version: version.version
    }))).toEqual([
      { id: ids.templateVersion, status: "published", version: 1 },
      { id: ids.templateVersion2, status: "draft", version: 2 }
    ]);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.publishingTemplateChange,
      auditActions.publishingTemplateChange,
      auditActions.publishingTemplateChange,
      auditActions.publishingTemplateChange
    ]);
  });

  it("rejects malformed template versions and skipped revision numbers", async () => {
    const publishingData = emptyData();
    await createMagazineTemplate(hqContext(), permissions, audit(), publishingData, {
      template: template(),
      version: templateVersion()
    });

    await expect(
      createTemplateRevision(hqContext(), permissions, audit(), publishingData, ids.template, {
        ...templateVersion(),
        id: ids.templateVersion2,
        version: 3
      })
    ).rejects.toThrow("next sequential");
    await expect(
      createTemplateRevision(hqContext(), permissions, audit(), publishingData, ids.template, {
        ...templateVersion(),
        id: ids.templateVersion2,
        version: 2,
        editableZones: []
      })
    ).rejects.toThrow("editable zones");
  });
});

function hqContext() {
  return {
    userId: ids.users.hq,
    organisationId: ids.organisations.hq
  };
}

function emptyData(): PublishingData {
  return {
    seasons: [],
    masterEditions: [],
    territoryEditions: [],
    magazineTemplates: [],
    magazineTemplateVersions: [],
    territories: [
      {
        id: ids.territories.own,
        franchiseOrganisationId: ids.organisations.franchise,
        code: "OWN",
        name: "Own Territory",
        status: "active"
      },
      {
        id: ids.territories.other,
        franchiseOrganisationId: ids.organisations.other,
        code: "OTH",
        name: "Other Territory",
        status: "active"
      }
    ]
  };
}

function seededData() {
  const publishingData = emptyData();
  publishingData.seasons.push(season());
  publishingData.masterEditions.push(masterEdition());
  return publishingData;
}

function season() {
  return {
    id: ids.season,
    key: "autumn-2026",
    name: "Autumn 2026",
    year: 2026,
    season: "autumn",
    status: "planned",
    accent: "autumn",
    publicationDate: "2026-09-01",
    bookingDeadline: "2026-07-24",
    artworkDeadline: "2026-08-07",
    editorialDeadline: "2026-08-12",
    proofDeadline: "2026-08-19",
    printDeadline: "2026-08-21",
    distributionDate: "2026-08-28"
  };
}

function masterEdition() {
  return {
    id: ids.master,
    seasonId: ids.season,
    organisationId: ids.organisations.hq,
    title: "Autumn 2026 Master Edition",
    status: "draft",
    pageCount: 36,
    version: 1,
    readiness: "not_ready",
    publicationArchive: {},
    locked: false,
    createdByUserId: ids.users.hq
  };
}

function template() {
  return {
    id: ids.template,
    key: "autumn-cover",
    name: "Autumn cover",
    category: "front_cover",
    status: "draft",
    createdByUserId: ids.users.hq
  };
}

function templateVersion() {
  return {
    id: ids.templateVersion,
    templateId: ids.template,
    version: 1,
    status: "draft",
    pageDimensions: { width: 210, height: 297, unit: "mm" },
    bleed: { top: 3, right: 3, bottom: 3, left: 3, unit: "mm" },
    trim: { width: 210, height: 297, unit: "mm" },
    margins: { top: 12, right: 12, bottom: 14, left: 12, unit: "mm" },
    grid: { columns: 6, gutter: 4 },
    lockedElements: [{ id: "brand-masthead", type: "logo", locked: true }],
    editableZones: [{ id: "local-cover-line", type: "headline", locked: false }],
    imageZones: [{ id: "hero", minDpi: 300 }],
    copyZones: [{ id: "strapline", maxWords: 14 }],
    headlineZones: [{ id: "cover-headline", maxCharacters: 60 }],
    advertiserZones: [{ id: "sponsor-strip", formats: ["full_width"] }],
    footerFurniture: { pageNumber: false },
    printRules: { colourSpace: "cmyk", minDpi: 300 },
    digitalEnhancements: { links: true }
  };
}

function grant(roleId: string, module: string, action: string, scope: string) {
  return {
    roleId,
    permission: {
      id: `${module}:${action}`,
      module,
      action
    },
    scope
  };
}

function audit() {
  return {
    events: [] as Array<{ action: string }>,
    async record(event: { action: string }) {
      this.events.push(event);
    }
  };
}

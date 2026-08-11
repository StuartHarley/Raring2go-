import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  createSeasonWithMasterEdition,
  approveTemplateVersion,
  applyLocalContentOverride,
  assignPageTemplateAndContent,
  autosaveLocalPageContent,
  createMagazineTemplate,
  createCentralContentItem,
  createEditionFlatplan,
  createTemplateRevision,
  distributeContentToTerritoryEditions,
  generateTerritoryEditions,
  generateDigitalOutput,
  generatePrintOutput,
  listEditionSummaries,
  publishTemplateVersion,
  applySafePreflightFixes,
  propagateMasterContentCorrection,
  reorderEditionPages,
  runPagePreflight,
  submitPageForReview
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
  templateVersion2: "template_cover_v2",
  content: "content_hq_days_out",
  territoryContent: "territory_content_own"
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
    grant(ids.roles.hq, "edition.page", "edit", "network"),
    grant(ids.roles.hq, "edition.content", "edit_local", "network"),
    grant(ids.roles.hq, "edition.content", "manage_locked", "network"),
    grant(ids.roles.hq, "edition.preflight", "override", "network"),
    grant(ids.roles.hq, "edition.output", "generate_print", "network"),
    grant(ids.roles.hq, "edition.output", "generate_digital", "network"),
    grant(ids.roles.local, "edition.page", "edit", "own_territory"),
    grant(ids.roles.local, "edition.content", "edit_local", "own_territory"),
    grant(ids.roles.local, "edition.preflight", "override", "own_territory"),
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

  it("distributes inherited HQ content and preserves local overrides on correction", async () => {
    const publishingData = seededData();
    await generateTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.master, [
      ids.territories.own,
      ids.territories.other
    ]);
    await createCentralContentItem(hqContext(), permissions, audit(), publishingData, contentItem());
    await distributeContentToTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.content, 1);
    const ownContent = publishingData.territoryEditionContent.find((content) => {
      const edition = publishingData.territoryEditions.find((candidate) => candidate.id === content.territoryEditionId);
      return edition?.territoryId === ids.territories.own;
    })!;
    await applyLocalContentOverride(
      {
        userId: ids.users.local,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissions,
      audit(),
      publishingData,
      ownContent.id,
      { headline: "Sutton days out" }
    );
    const result = await propagateMasterContentCorrection(
      hqContext(),
      permissions,
      audit(),
      publishingData,
      ids.content,
      { headline: "Updated national days out", body: "Corrected HQ copy." },
      2
    );

    expect(result).toEqual({ updatedCount: 1, skippedOverrides: 1 });
    expect(ownContent).toMatchObject({
      inheritanceState: "overridden",
      effectiveContent: {
        headline: "Sutton days out",
        body: "National copy."
      },
      sourceVersion: 1
    });
    const inherited = publishingData.territoryEditionContent.find((content) => content.id !== ownContent.id)!;
    expect(inherited).toMatchObject({
      inheritanceState: "inherited",
      effectiveContent: {
        headline: "Updated national days out",
        body: "Corrected HQ copy."
      },
      sourceVersion: 2
    });
  });

  it("creates a visual flatplan and assigns published templates/content", async () => {
    const publishingData = seededData();
    await generateTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.master, [ids.territories.own]);
    publishingData.magazineTemplates.push(template());
    publishingData.magazineTemplateVersions.push({ ...templateVersion(), status: "published" });
    await createCentralContentItem(hqContext(), permissions, audit(), publishingData, contentItem());
    await distributeContentToTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.content, 1);
    const edition = publishingData.territoryEditions[0]!;
    const pages = await createEditionFlatplan(hqContext(), permissions, audit(), publishingData, edition.id);
    const page = await assignPageTemplateAndContent(hqContext(), permissions, audit(), publishingData, pages[2]!.id, {
      templateVersionId: ids.templateVersion,
      assignedContentId: publishingData.territoryEditionContent[0]!.id
    });

    expect(pages).toHaveLength(36);
    expect(pages[0]).toMatchObject({ pageNumber: 1, side: "single", locked: true });
    expect(page).toMatchObject({
      status: "in_progress",
      readiness: "in_progress",
      sourceMarker: "local"
    });
  });

  it("rejects moving locked flatplan pages", async () => {
    const publishingData = seededData();
    await generateTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.master, [ids.territories.own]);
    const pages = await createEditionFlatplan(hqContext(), permissions, audit(), publishingData, publishingData.territoryEditions[0]!.id);

    await expect(
      reorderEditionPages(hqContext(), permissions, audit(), publishingData, publishingData.territoryEditions[0]!.id, [
        pages[1]!.id,
        pages[0]!.id,
        ...pages.slice(2).map((page) => page.id)
      ])
    ).rejects.toThrow("Locked pages");
  });

  it("autosaves local page edits with revision history and warning states", async () => {
    const publishingData = await editableFlatplanData();
    const page = publishingData.editionPages.find((candidate) => !candidate.locked && candidate.sourceMarker === "local")!;

    const result = await autosaveLocalPageContent(
      {
        userId: ids.users.local,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissions,
      audit(),
      publishingData,
      page.id,
      { body: "Short local copy", imageRequired: true }
    );

    expect(result.page.readiness).toBe("blocked");
    expect(result.revision).toMatchObject({
      revisionNumber: 1,
      changeType: "autosave",
      warnings: [{ type: "missing_image", message: "Required image is missing." }]
    });
    await expect(
      submitPageForReview(
        {
          userId: ids.users.local,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissions,
        audit(),
        publishingData,
        page.id
      )
    ).rejects.toThrow("warnings");
  });

  it("submits complete local pages for HQ review", async () => {
    const publishingData = await editableFlatplanData();
    const page = publishingData.editionPages.find((candidate) => !candidate.locked && candidate.sourceMarker === "local")!;
    await autosaveLocalPageContent(
      {
        userId: ids.users.local,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissions,
      audit(),
      publishingData,
      page.id,
      { body: "Short local copy", imageAssetId: "asset_1" }
    );

    const result = await submitPageForReview(
      {
        userId: ids.users.local,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissions,
      audit(),
      publishingData,
      page.id
    );

    expect(result.page).toMatchObject({
      status: "awaiting_hq",
      readiness: "ready"
    });
    expect(publishingData.editionPageRevisions.map((revision) => revision.changeType)).toEqual([
      "autosave",
      "submit_review"
    ]);
  });

  it("runs page preflight and preserves original artefacts while applying safe fixes", async () => {
    const publishingData = await editableFlatplanData();
    const page = publishingData.editionPages.find((candidate) => !candidate.locked && candidate.sourceMarker === "local")!;
    const recorder = audit();
    const result = await runPagePreflight(hqContext(), permissions, recorder, publishingData, page.id, {
      fileKey: "uploads/local-page-03.pdf",
      colourSpace: "rgb",
      dpi: 240,
      bleedPresent: false,
      linksChecked: false,
      allowColourConversion: true,
      allowBleedExtension: true
    });

    expect(result).toMatchObject({
      status: "failed",
      originalArtifact: {
        fileKey: "uploads/local-page-03.pdf",
        colourSpace: "rgb"
      },
      unfixableIssues: [
        {
          code: "low_resolution",
          fixable: false
        }
      ]
    });

    const fixed = await applySafePreflightFixes(hqContext(), permissions, recorder, publishingData, result.id);

    expect(fixed.originalArtifact).toMatchObject({ colourSpace: "rgb", dpi: 240 });
    expect(fixed.derivedArtifact).toMatchObject({
      derivedFromPreflightResultId: result.id,
      safeFixesApplied: ["colour_space_rgb", "missing_bleed", "unchecked_links"]
    });
    expect(fixed.status).toBe("failed");
    expect(page).toMatchObject({
      status: "preflight_failed",
      readiness: "blocked",
      issues: [
        {
          type: "low_resolution",
          fixable: false
        }
      ]
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.publishingPreflightOverride,
      auditActions.publishingPreflightOverride
    ]);
  });

  it("marks pages print-ready when preflight fixes remove every issue", async () => {
    const publishingData = await editableFlatplanData();
    const page = publishingData.editionPages.find((candidate) => !candidate.locked && candidate.sourceMarker === "local")!;
    const result = await runPagePreflight(hqContext(), permissions, audit(), publishingData, page.id, {
      fileKey: "uploads/local-page-04.pdf",
      colourSpace: "rgb",
      dpi: 300,
      bleedPresent: false,
      linksChecked: true,
      allowColourConversion: true,
      allowBleedExtension: true
    });

    const fixed = await applySafePreflightFixes(hqContext(), permissions, audit(), publishingData, result.id);

    expect(fixed).toMatchObject({
      status: "fixed",
      unfixableIssues: []
    });
    expect(page).toMatchObject({
      status: "print_ready",
      readiness: "ready",
      issues: []
    });
  });

  it("generates print and digital outputs from the same approved territory edition", async () => {
    const publishingData = await printReadyEditionData();
    const edition = publishingData.territoryEditions[0]!;
    const recorder = audit();

    const print = await generatePrintOutput(hqContext(), permissions, recorder, publishingData, edition.id, {
      idempotencyKey: "print-autumn-sutton-v1",
      artifact: { storageKey: "outputs/autumn-sutton-print-v1.pdf", format: "pdfx" }
    });
    const duplicatePrint = await generatePrintOutput(hqContext(), permissions, recorder, publishingData, edition.id, {
      idempotencyKey: "print-autumn-sutton-v1",
      artifact: { storageKey: "ignored.pdf" }
    });
    const digital = await generateDigitalOutput(hqContext(), permissions, recorder, publishingData, edition.id, {
      idempotencyKey: "digital-autumn-sutton-v1",
      artifact: { storageKey: "outputs/autumn-sutton-digital-v1.html", format: "html" },
      metadata: { canonicalUrl: "/editions/autumn-sutton" }
    });

    expect(duplicatePrint.id).toBe(print.id);
    expect(publishingData.publicationOutputs).toHaveLength(2);
    expect(print.sourcePageSnapshot.map((page) => page.pageNumber)).toEqual([1, 2, 3, 4]);
    expect(digital.sourcePageSnapshot).toEqual(print.sourcePageSnapshot);
    expect(digital.metadata).toMatchObject({
      accessibility: "required",
      links: "tracked",
      canonicalUrl: "/editions/autumn-sutton"
    });
    expect(edition).toMatchObject({
      printStatus: "generated",
      digitalStatus: "generated"
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.publishingPrintGenerate,
      auditActions.publishingDigitalGenerate
    ]);
  });

  it("blocks output generation until pages are ready and print preflight has passed", async () => {
    const publishingData = await editableFlatplanData(4);
    const edition = publishingData.territoryEditions[0]!;
    edition.status = "approved";
    publishingData.editionPages.forEach((page) => {
      page.readiness = "ready";
      page.status = "print_ready";
    });
    publishingData.editionPages[2]!.readiness = "blocked";

    await expect(
      generateDigitalOutput(hqContext(), permissions, audit(), publishingData, edition.id, {
        idempotencyKey: "digital-blocked",
        artifact: { storageKey: "outputs/blocked.html" }
      })
    ).rejects.toThrow("ready and clear");

    publishingData.editionPages[2]!.readiness = "ready";
    await expect(
      generatePrintOutput(hqContext(), permissions, audit(), publishingData, edition.id, {
        idempotencyKey: "print-no-preflight",
        artifact: { storageKey: "outputs/no-preflight.pdf" }
      })
    ).rejects.toThrow("successful preflight");
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
    editionContentItems: [],
    territoryEditionContent: [],
    editionPages: [],
    editionPageRevisions: [],
    preflightResults: [],
    publicationOutputs: [],
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

function contentItem() {
  return {
    id: ids.content,
    sourceLevel: "hq_master",
    title: "National days out",
    contentType: "article",
    status: "approved",
    inheritanceMode: "mandatory",
    locked: false,
    localisable: true,
    advertiserSpecific: false,
    body: {
      headline: "National days out",
      body: "National copy."
    },
    targeting: {},
    createdByUserId: ids.users.hq
  };
}

async function editableFlatplanData(pageCount = 36) {
  const publishingData = seededData();
  publishingData.masterEditions[0]!.pageCount = pageCount;
  await generateTerritoryEditions(hqContext(), permissions, audit(), publishingData, ids.master, [ids.territories.own]);
  await createEditionFlatplan(hqContext(), permissions, audit(), publishingData, publishingData.territoryEditions[0]!.id);
  return publishingData;
}

async function printReadyEditionData(pageCount = 4) {
  const publishingData = await editableFlatplanData(pageCount);
  const edition = publishingData.territoryEditions[0]!;
  edition.status = "approved";
  publishingData.editionPages.forEach((page, index) => {
    page.pageNumber = index + 1;
    page.spreadNumber = Math.ceil(page.pageNumber / 2);
    page.status = "print_ready";
    page.readiness = "ready";
    page.issues = [];
    publishingData.preflightResults.push({
      id: `preflight_${page.pageNumber}`,
      entityType: "edition_page",
      entityId: page.id,
      territoryEditionId: edition.id,
      status: "passed",
      checks: [],
      fixes: [],
      originalArtifact: { storageKey: `pages/page-${page.pageNumber}.pdf` },
      derivedArtifact: {},
      unfixableIssues: [],
      createdByUserId: ids.users.hq
    });
  });
  return publishingData;
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

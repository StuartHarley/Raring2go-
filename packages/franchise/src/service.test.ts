import { auditActions } from "@raring2go/audit";
import { describe, expect, it } from "vitest";
import {
  assertNoDuplicatedIdentityData,
  addFranchiseDocumentVersion,
  approveAgreement,
  archiveFranchiseDocument,
  cancelSignatureRequest,
  ensureComplianceActions,
  submitComplianceEvidence,
  upsertInsurancePolicy,
  createFranchise,
  verifyComplianceRecord,
  verifyInsurancePolicy,
  generateAgreement,
  getFranchise360,
  listActiveFranchises,
  listNetworkComplianceOverview,
  recordSignatureProviderEvent,
  reissueSignatureRequest,
  resendSignatureRequest,
  resolveComplianceAction,
  sendAgreementForSignature,
  submitAgreementForApproval,
  uploadFranchiseDocument,
  voidAgreement,
  updateFranchise
} from "./service";
import type { FranchiseData, FranchiseRecord } from "./types";
import type { PermissionData } from "@raring2go/permissions";

const ids = {
  users: {
    hq: "user_hq",
    owner: "user_owner"
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
    local: "role_local",
    readonly: "role_readonly"
  },
  permissions: {
    view: "permission_franchise_view",
    create: "permission_franchise_create",
    edit: "permission_franchise_edit",
    agreementView: "permission_agreement_view",
    agreementGenerate: "permission_agreement_generate",
    agreementSubmit: "permission_agreement_submit",
    agreementApprove: "permission_agreement_approve",
    agreementVoid: "permission_agreement_void",
    agreementSendSignature: "permission_agreement_send_signature",
    agreementCancelSignature: "permission_agreement_cancel_signature",
    agreementResendSignature: "permission_agreement_resend_signature",
    agreementRecordSignatureEvent: "permission_agreement_record_signature_event",
    documentView: "permission_document_view",
    documentUpload: "permission_document_upload",
    documentDownload: "permission_document_download",
    documentArchive: "permission_document_archive",
    complianceView: "permission_compliance_view",
    complianceManageRequirements: "permission_compliance_manage_requirements",
    complianceSubmitEvidence: "permission_compliance_submit_evidence",
    complianceVerify: "permission_compliance_verify",
    complianceManageActions: "permission_compliance_manage_actions",
    complianceViewNetwork: "permission_compliance_view_network"
  },
  franchises: {
    own: "franchise_own",
    other: "franchise_other",
    archived: "franchise_archived"
  },
  agreements: {
    template: "agreement_template",
    version: "agreement_version",
    nextVersion: "agreement_version_next",
    draft: "agreement_draft"
  }
} as const;

const permissionData: PermissionData = {
  roleAssignments: [
    {
      id: "assignment_hq",
      userId: ids.users.hq,
      roleId: ids.roles.hq,
      organisationId: ids.organisations.hq
    },
    {
      id: "assignment_local",
      userId: ids.users.owner,
      roleId: ids.roles.local,
      organisationId: ids.organisations.franchise,
      territoryId: ids.territories.own
    }
  ],
  rolePermissions: [
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.view,
        module: "franchise",
        action: "view"
      },
      scope: "network"
    },
    agreementGrant(ids.permissions.agreementView, "view"),
    agreementGrant(ids.permissions.agreementGenerate, "generate"),
    agreementGrant(ids.permissions.agreementSubmit, "submit_approval"),
    agreementGrant(ids.permissions.agreementApprove, "approve"),
    agreementGrant(ids.permissions.agreementVoid, "void"),
    agreementGrant(ids.permissions.agreementSendSignature, "send_signature"),
    agreementGrant(ids.permissions.agreementCancelSignature, "cancel_signature"),
    agreementGrant(ids.permissions.agreementResendSignature, "resend_signature"),
    agreementGrant(ids.permissions.agreementRecordSignatureEvent, "record_signature_event"),
    documentGrant(ids.permissions.documentView, "view"),
    documentGrant(ids.permissions.documentUpload, "upload"),
    documentGrant(ids.permissions.documentDownload, "download"),
    documentGrant(ids.permissions.documentArchive, "archive"),
    complianceGrant(ids.permissions.complianceView, "view"),
    complianceGrant(ids.permissions.complianceManageRequirements, "manage_requirements"),
    complianceGrant(ids.permissions.complianceSubmitEvidence, "submit_evidence"),
    complianceGrant(ids.permissions.complianceVerify, "verify"),
    complianceGrant(ids.permissions.complianceManageActions, "manage_actions"),
    complianceGrant(ids.permissions.complianceViewNetwork, "view_network"),
    {
      roleId: ids.roles.local,
      permission: {
        id: ids.permissions.agreementView,
        module: "franchise.agreement",
        action: "view"
      },
      scope: "own_territory"
    },
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.create,
        module: "franchise",
        action: "create"
      },
      scope: "network"
    },
    {
      roleId: ids.roles.hq,
      permission: {
        id: ids.permissions.edit,
        module: "franchise",
        action: "edit"
      },
      scope: "network"
    },
    {
      roleId: ids.roles.local,
      permission: {
        id: ids.permissions.view,
        module: "franchise",
        action: "view"
      },
      scope: "own_territory"
    },
    {
      roleId: ids.roles.local,
      permission: {
        id: ids.permissions.complianceSubmitEvidence,
        module: "franchise.compliance",
        action: "submit_evidence"
      },
      scope: "own_territory"
    }
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

function data(): FranchiseData {
  return {
    franchises: [
      franchise({
        id: ids.franchises.own,
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own
      }),
      franchise({
        id: ids.franchises.other,
        franchiseOrganisationId: ids.organisations.other,
        primaryTerritoryId: ids.territories.other
      }),
      franchise({
        id: ids.franchises.archived,
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own,
        status: "archived",
        deletedAt: new Date("2026-08-10T00:00:00.000Z")
      })
    ],
    contacts: [
      {
        id: "contact_owner",
        franchiseId: ids.franchises.own,
        userId: ids.users.owner,
        label: "Owner",
        isPrimary: true
      },
      {
        id: "contact_external",
        franchiseId: ids.franchises.own,
        label: "Bookkeeper",
        name: "External Contact",
        email: "bookkeeper@example.com",
        isPrimary: false
      }
    ],
    organisations: [
      {
        id: ids.organisations.hq,
        kind: "hq",
        name: "HQ"
      },
      {
        id: ids.organisations.franchise,
        kind: "franchise",
        name: "Raring2go Sutton Coldfield"
      },
      {
        id: ids.organisations.other,
        kind: "franchise",
        name: "Raring2go Elsewhere"
      }
    ],
    territories: [
      {
        id: ids.territories.own,
        franchiseOrganisationId: ids.organisations.franchise,
        code: "SUT",
        name: "Sutton Coldfield",
        status: "active"
      },
      {
        id: ids.territories.other,
        franchiseOrganisationId: ids.organisations.other,
        code: "OTH",
        name: "Elsewhere",
        status: "active"
      }
    ],
    users: [
      {
        id: ids.users.hq,
        email: "hq@example.com",
        displayName: "HQ"
      },
      {
        id: ids.users.owner,
        email: "owner@example.com",
        displayName: "Owner"
      }
    ],
    agreementTemplates: [
      {
        id: ids.agreements.template,
        key: "standard",
        name: "Standard Agreement",
        status: "active"
      }
    ],
    agreementVersions: [
      {
        id: ids.agreements.version,
        templateId: ids.agreements.template,
        version: "1.0",
        status: "approved",
        controlledMergeFields: ["territoryName", "ownerName"],
        content: {
          title: "Agreement v1"
        }
      },
      {
        id: ids.agreements.nextVersion,
        templateId: ids.agreements.template,
        version: "2.0",
        status: "approved",
        controlledMergeFields: ["territoryName", "ownerName"],
        content: {
          title: "Agreement v2"
        }
      }
    ],
    franchiseAgreements: [],
    artifactReferences: [],
    documents: [],
    documentVersions: [],
    insurancePolicies: [],
    complianceRequirements: [
      {
        id: "requirement_insurance",
        key: "public-liability-insurance",
        name: "Public liability insurance",
        requiredDocumentCategory: "insurance_certificate",
        requiredDocumentType: "public_liability",
        expiryWarningDays: 60,
        active: true
      }
    ],
    complianceRecords: [],
    complianceActions: [],
    complianceReminders: [],
    activity: [
      {
        id: "event_1",
        action: auditActions.franchiseUpdate,
        entityType: "franchise",
        entityId: ids.franchises.own,
        createdAt: new Date("2026-08-10T00:00:00.000Z")
      }
    ]
  };
}

describe("franchise service", () => {
  it("returns deterministic relationship data without duplicated identities", () => {
    const view = getFranchise360(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      data(),
      ids.franchises.own
    );

    expect(view.franchise.franchiseOrganisationId).toBe(ids.organisations.franchise);
    expect(view.franchise.primaryTerritoryId).toBe(ids.territories.own);
    expect(view.owner?.id).toBe(ids.users.owner);
    expect(assertNoDuplicatedIdentityData(view.franchise)).toBe(true);
  });

  it("allows authorised network view and excludes archived records", () => {
    expect(
      listActiveFranchises(
        {
          userId: ids.users.hq,
          organisationId: ids.organisations.hq
        },
        permissionData,
        data()
      ).map((franchiseRecord) => franchiseRecord.id)
    ).toEqual([ids.franchises.own, ids.franchises.other]);
  });

  it("allows authorised own-territory view", () => {
    expect(
      getFranchise360(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        data(),
        ids.franchises.own
      ).territory.name
    ).toBe("Sutton Coldfield");
  });

  it("denies cross-territory URL access", () => {
    expect(() =>
      getFranchise360(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        data(),
        ids.franchises.other
      )
    ).toThrow("outside the active territory");
  });

  it("denies create and edit without capability", async () => {
    await expect(
      createFranchise(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        data(),
        franchise({
          id: "franchise_new",
          franchiseOrganisationId: ids.organisations.franchise,
          primaryTerritoryId: ids.territories.own
        })
      )
    ).rejects.toThrow("No permission grant");

    await expect(
      updateFranchise(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        data(),
        {
          franchiseId: ids.franchises.own,
          patch: {
            supportStatus: "enhanced"
          }
        }
      )
    ).rejects.toThrow("No permission grant");
  });

  it("writes audit events for mutations", async () => {
    const franchiseData = data();
    const recorder = audit();

    await createFranchise(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      recorder,
      franchiseData,
      franchise({
        id: "franchise_new",
        franchiseOrganisationId: ids.organisations.franchise,
        primaryTerritoryId: ids.territories.own
      })
    );

    await updateFranchise(
      {
        userId: ids.users.hq,
        organisationId: ids.organisations.hq
      },
      permissionData,
      recorder,
      franchiseData,
      {
        franchiseId: ids.franchises.own,
        patch: {
          supportStatus: "enhanced"
        }
      }
    );

    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseCreate,
      auditActions.franchiseUpdate
    ]);
  });

  it("renders deferred tabs without future domain tables", () => {
    const view = getFranchise360(
        {
          userId: ids.users.hq,
          organisationId: ids.organisations.hq
        },
        permissionData,
        data(),
        ids.franchises.own
      );

    expect(view.documents).toEqual([]);
    expect(view.placeholders).toEqual({
      performance: "deferred",
      training: "deferred",
      support: "deferred"
    });
  });

  it("uploads and displays active document versions in Franchisee 360", async () => {
    const franchiseData = data();
    const recorder = audit();

    await uploadFranchiseDocument(hqContext(), permissionData, recorder, franchiseData, {
      document: documentRecord("document_1", "version_1"),
      version: documentVersion("version_1", "document_1", 1, "artifact_1"),
      artifact: documentArtifact("artifact_1", "document_1")
    });
    await addFranchiseDocumentVersion(hqContext(), permissionData, recorder, franchiseData, {
      documentId: "document_1",
      version: documentVersion("version_2", "document_1", 2, "artifact_2"),
      artifact: documentArtifact("artifact_2", "document_1")
    });

    const view = getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own);
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0]?.currentVersion?.versionNumber).toBe(2);
    expect(view.documents[0]?.artifact?.storageKey).toBe("documents/artifact_2.pdf");
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseDocumentUpload,
      auditActions.franchiseDocumentVersionCreate
    ]);
  });

  it("rejects invalid document scope and non-sequential versions", async () => {
    const franchiseData = data();
    await expect(
      uploadFranchiseDocument(hqContext(), permissionData, audit(), franchiseData, {
        document: {
          ...documentRecord("document_1", "version_1"),
          territoryId: ids.territories.other
        },
        version: documentVersion("version_1", "document_1", 1, "artifact_1"),
        artifact: documentArtifact("artifact_1", "document_1")
      })
    ).rejects.toThrow("Document scope does not match");

    await uploadFranchiseDocument(hqContext(), permissionData, audit(), franchiseData, {
      document: documentRecord("document_1", "version_1"),
      version: documentVersion("version_1", "document_1", 1, "artifact_1"),
      artifact: documentArtifact("artifact_1", "document_1")
    });
    await expect(
      addFranchiseDocumentVersion(hqContext(), permissionData, audit(), franchiseData, {
        documentId: "document_1",
        version: documentVersion("version_3", "document_1", 3, "artifact_3"),
        artifact: documentArtifact("artifact_3", "document_1")
      })
    ).rejects.toThrow("sequential");
  });

  it("archives documents, hides them from active views and writes audit", async () => {
    const franchiseData = data();
    const recorder = audit();
    await uploadFranchiseDocument(hqContext(), permissionData, audit(), franchiseData, {
      document: documentRecord("document_1", "version_1"),
      version: documentVersion("version_1", "document_1", 1, "artifact_1"),
      artifact: documentArtifact("artifact_1", "document_1")
    });

    await archiveFranchiseDocument(hqContext(), permissionData, recorder, franchiseData, "document_1");

    expect(franchiseData.documents?.[0]?.status).toBe("archived");
    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).documents).toEqual([]);
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseDocumentArchive
    ]);
  });

  it("denies document mutations without capability", async () => {
    const franchiseData = data();

    await expect(
      uploadFranchiseDocument(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        franchiseData,
        {
          document: documentRecord("document_1", "version_1"),
          version: documentVersion("version_1", "document_1", 1, "artifact_1"),
          artifact: documentArtifact("artifact_1", "document_1")
        }
      )
    ).rejects.toThrow("No permission grant");
  });

  it("summarises missing pending complete and expiring compliance state", async () => {
    const franchiseData = data();
    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).compliance).toMatchObject({
      status: "missing",
      completeCount: 0,
      totalCount: 1,
      actionsRequired: 1
    });

    await uploadFranchiseDocument(hqContext(), permissionData, audit(), franchiseData, {
      document: {
        ...documentRecord("document_1", "version_1"),
        category: "insurance_certificate",
        documentType: "public_liability",
        expiryDate: "2026-09-21"
      },
      version: documentVersion("version_1", "document_1", 1, "artifact_1"),
      artifact: documentArtifact("artifact_1", "document_1")
    });
    await submitComplianceEvidence(
      {
        userId: ids.users.owner,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissionData,
      audit(),
      franchiseData,
      {
        id: "record_1",
        franchiseId: ids.franchises.own,
        requirementId: "requirement_insurance",
        evidenceDocumentId: "document_1",
        status: "missing",
        expiresAt: "2026-09-21"
      }
    );
    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).compliance.status).toBe("pending_review");
    await verifyComplianceRecord(hqContext(), permissionData, audit(), franchiseData, "record_1", {
      status: "complete"
    });
    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).compliance).toMatchObject({
      status: "expiring_soon",
      completeCount: 0,
      actionsRequired: 1
    });
  });

  it("upserts and verifies insurance with scoped evidence and audit", async () => {
    const franchiseData = data();
    const recorder = audit();
    await uploadFranchiseDocument(hqContext(), permissionData, audit(), franchiseData, {
      document: {
        ...documentRecord("document_1", "version_1"),
        category: "insurance_certificate",
        documentType: "public_liability"
      },
      version: documentVersion("version_1", "document_1", 1, "artifact_1"),
      artifact: documentArtifact("artifact_1", "document_1")
    });

    await upsertInsurancePolicy(
      {
        userId: ids.users.owner,
        organisationId: ids.organisations.franchise,
        territoryId: ids.territories.own
      },
      permissionData,
      recorder,
      franchiseData,
      {
        id: "policy_1",
        franchiseId: ids.franchises.own,
        provider: "Seed Mutual",
        policyNumber: "PL-001",
        coverTypes: ["public_liability"],
        coverStartDate: "2025-09-22",
        coverEndDate: "2026-09-21",
        evidenceDocumentId: "document_1",
        verificationStatus: "pending"
      }
    );
    await verifyInsurancePolicy(hqContext(), permissionData, recorder, franchiseData, "policy_1", {
      status: "verified"
    });

    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).insurancePolicies[0]).toMatchObject({
      verificationStatus: "verified",
      verifiedByUserId: ids.users.hq
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseInsuranceUpsert,
      auditActions.franchiseInsuranceVerify
    ]);
  });

  it("rejects cross-territory compliance evidence", async () => {
    const franchiseData = data();
    franchiseData.documents = [
      {
        ...documentRecord("other_document", "other_version"),
        franchiseId: ids.franchises.other,
        organisationId: ids.organisations.other,
        territoryId: ids.territories.other
      }
    ];

    await expect(
      submitComplianceEvidence(hqContext(), permissionData, audit(), franchiseData, {
        id: "record_1",
        franchiseId: ids.franchises.own,
        requirementId: "requirement_insurance",
        evidenceDocumentId: "other_document",
        status: "pending_review"
      })
    ).rejects.toThrow("Document scope does not match");
  });

  it("creates compliance actions and reminders idempotently", async () => {
    const franchiseData = data();
    const recorder = audit();

    const first = await ensureComplianceActions(
      hqContext(),
      permissionData,
      recorder,
      franchiseData,
      ids.franchises.own
    );
    const second = await ensureComplianceActions(
      hqContext(),
      permissionData,
      recorder,
      franchiseData,
      ids.franchises.own
    );

    expect(first.actions).toHaveLength(1);
    expect(first.reminders).toHaveLength(1);
    expect(second.actions).toHaveLength(0);
    expect(second.reminders).toHaveLength(0);
    expect(franchiseData.complianceActions?.[0]).toMatchObject({
      status: "open",
      severity: "critical"
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseComplianceActionCreate,
      auditActions.franchiseComplianceReminderSchedule
    ]);
  });

  it("resolves compliance actions with audit", async () => {
    const franchiseData = data();
    await ensureComplianceActions(hqContext(), permissionData, audit(), franchiseData, ids.franchises.own);
    const actionId = franchiseData.complianceActions![0]!.id;
    const recorder = audit();

    await resolveComplianceAction(hqContext(), permissionData, recorder, franchiseData, actionId);

    expect(franchiseData.complianceActions?.[0]).toMatchObject({
      status: "resolved",
      resolvedAt: expect.any(String)
    });
    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseComplianceActionResolve
    ]);
  });

  it("lists network compliance overview only with capability", async () => {
    const franchiseData = data();
    await ensureComplianceActions(hqContext(), permissionData, audit(), franchiseData, ids.franchises.own);

    expect(listNetworkComplianceOverview(hqContext(), permissionData, franchiseData)[0]).toMatchObject({
      status: "missing",
      actionsRequired: 1,
      openActions: 1
    });
    expect(() =>
      listNetworkComplianceOverview(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        franchiseData
      )
    ).toThrow("No permission grant");
  });

  it("denies agreement generation without permission", async () => {
    await expect(
      generateAgreement(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        data(),
        {
          id: ids.agreements.draft,
          franchiseId: ids.franchises.own,
          agreementVersionId: ids.agreements.version,
          mergeVariables: {
            territoryName: "Sutton Coldfield",
            ownerName: "Owner"
          }
        }
      )
    ).rejects.toThrow("No permission grant");
  });

  it("stores the approved template version and merge-variable snapshot", async () => {
    const franchiseData = data();

    const agreement = await generateAgreement(
      hqContext(),
      permissionData,
      audit(),
      franchiseData,
      {
        id: ids.agreements.draft,
        franchiseId: ids.franchises.own,
        agreementVersionId: ids.agreements.version,
        mergeVariables: {
          territoryName: "Sutton Coldfield",
          ownerName: "Owner"
        }
      }
    );

    expect(agreement.agreementVersionId).toBe(ids.agreements.version);
    expect(agreement.mergeVariables).toEqual({
      territoryName: "Sutton Coldfield",
      ownerName: "Owner"
    });
    expect(getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own).agreement?.version.version).toBe("1.0");
  });

  it("does not allow approval to be skipped and rejects invalid state transitions", async () => {
    const franchiseData = data();
    await generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
      id: ids.agreements.draft,
      franchiseId: ids.franchises.own,
      agreementVersionId: ids.agreements.version,
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });

    await expect(
      approveAgreement(hqContext(), permissionData, audit(), franchiseData, ids.agreements.draft)
    ).rejects.toThrow("Invalid agreement lifecycle transition");

    await submitAgreementForApproval(
      hqContext(),
      permissionData,
      audit(),
      franchiseData,
      ids.agreements.draft
    );
    await approveAgreement(hqContext(), permissionData, audit(), franchiseData, ids.agreements.draft);

    await expect(
      voidAgreement(hqContext(), permissionData, audit(), franchiseData, ids.agreements.draft)
    ).rejects.toThrow("Invalid agreement lifecycle transition");
  });

  it("denies agreement approval without approval capability", async () => {
    const franchiseData = data();
    await generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
      id: ids.agreements.draft,
      franchiseId: ids.franchises.own,
      agreementVersionId: ids.agreements.version,
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });
    await submitAgreementForApproval(
      hqContext(),
      permissionData,
      audit(),
      franchiseData,
      ids.agreements.draft
    );

    await expect(
      approveAgreement(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        franchiseData,
        ids.agreements.draft
      )
    ).rejects.toThrow("No permission grant");
  });

  it("keeps approved agreements durable after template updates", async () => {
    const franchiseData = data();
    const agreement = await generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
      id: ids.agreements.draft,
      franchiseId: ids.franchises.own,
      agreementVersionId: ids.agreements.version,
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });
    await submitAgreementForApproval(hqContext(), permissionData, audit(), franchiseData, agreement.id);
    await approveAgreement(hqContext(), permissionData, audit(), franchiseData, agreement.id);
    const [firstAgreementVersion] = franchiseData.agreementVersions!;
    franchiseData.agreementVersions![0] = {
      ...firstAgreementVersion!,
      content: { title: "Mutated template" }
    };

    expect(agreement.generatedContent).toEqual({
      title: "Agreement v1",
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });
    await expect(
      generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
        id: "agreement_second",
        franchiseId: ids.franchises.own,
        agreementVersionId: ids.agreements.nextVersion,
        mergeVariables: {
          territoryName: "Sutton Coldfield",
          ownerName: "Owner"
        }
      })
    ).rejects.toThrow("Approved agreements are durable");
  });

  it("writes audit events for agreement lifecycle mutations", async () => {
    const franchiseData = data();
    const recorder = audit();

    await generateAgreement(hqContext(), permissionData, recorder, franchiseData, {
      id: ids.agreements.draft,
      franchiseId: ids.franchises.own,
      agreementVersionId: ids.agreements.version,
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });
    await submitAgreementForApproval(hqContext(), permissionData, recorder, franchiseData, ids.agreements.draft);
    await approveAgreement(hqContext(), permissionData, recorder, franchiseData, ids.agreements.draft);

    expect(recorder.events.map((event) => event.action)).toEqual([
      auditActions.franchiseAgreementGenerate,
      auditActions.franchiseAgreementSubmit,
      auditActions.franchiseAgreementApprove
    ]);
  });

  it("denies sending without permission and blocks non-approved agreements", async () => {
    const franchiseData = data();
    await expect(
      sendAgreementForSignature(
        {
          userId: ids.users.owner,
          organisationId: ids.organisations.franchise,
          territoryId: ids.territories.own
        },
        permissionData,
        audit(),
        franchiseData,
        provider(),
        {
          requestId: "request_1",
          agreementId: ids.agreements.draft,
          signers: signerPlan("request_1")
        }
      )
    ).rejects.toThrow("Agreement was not found");

    await generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
      id: ids.agreements.draft,
      franchiseId: ids.franchises.own,
      agreementVersionId: ids.agreements.version,
      mergeVariables: {
        territoryName: "Sutton Coldfield",
        ownerName: "Owner"
      }
    });

    await expect(
      sendAgreementForSignature(hqContext(), permissionData, audit(), franchiseData, provider(), {
        requestId: "request_1",
        agreementId: ids.agreements.draft,
        signers: signerPlan("request_1")
      })
    ).rejects.toThrow("Only approved agreements");
  });

  it("enforces signer order and required signer completion", async () => {
    const franchiseData = await approvedAgreementData();
    await sendAgreementForSignature(hqContext(), permissionData, audit(), franchiseData, provider(), {
      requestId: "request_1",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_1")
    });

    await expect(
      recordSignatureProviderEvent(hqContext(), permissionData, audit(), franchiseData, {
        eventId: "event_wrong_order",
        requestId: "request_1",
        eventType: "signer.completed",
        signerId: "request_1-franchisor"
      })
    ).rejects.toThrow("Signer order");

    await recordSignatureProviderEvent(hqContext(), permissionData, audit(), franchiseData, {
      eventId: "event_1",
      requestId: "request_1",
      eventType: "signer.completed",
      signerId: "request_1-franchisee"
    });
    await expect(
      recordSignatureProviderEvent(hqContext(), permissionData, audit(), franchiseData, {
        eventId: "event_complete_early",
        requestId: "request_1",
        eventType: "completed",
        signedAgreementArtifact: signedArtifact("signed_1"),
        completionCertificateArtifact: certificateArtifact("cert_1")
      })
    ).rejects.toThrow("Every required signer");
  });

  it("supports send resend cancel declined expired and idempotent provider events", async () => {
    const franchiseData = await approvedAgreementData();
    const recorder = audit();
    await sendAgreementForSignature(hqContext(), permissionData, recorder, franchiseData, provider(), {
      requestId: "request_1",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_1")
    });
    await resendSignatureRequest(hqContext(), permissionData, recorder, franchiseData, provider(), "request_1");
    await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_declined",
      requestId: "request_1",
      eventType: "declined"
    });
    const duplicate = await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_declined",
      requestId: "request_1",
      eventType: "declined"
    });

    expect(duplicate.duplicate).toBe(true);
    expect(franchiseData.signatureRequests?.[0]?.status).toBe("declined");

    const expiredData = await approvedAgreementData();
    await sendAgreementForSignature(hqContext(), permissionData, audit(), expiredData, provider(), {
      requestId: "request_expired",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_expired")
    });
    await recordSignatureProviderEvent(hqContext(), permissionData, audit(), expiredData, {
      eventId: "event_expired",
      requestId: "request_expired",
      eventType: "expired"
    });
    expect(expiredData.signatureRequests?.[0]?.status).toBe("expired");

    const cancelledData = await approvedAgreementData();
    await sendAgreementForSignature(hqContext(), permissionData, audit(), cancelledData, provider(), {
      requestId: "request_cancelled",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_cancelled")
    });
    await cancelSignatureRequest(hqContext(), permissionData, audit(), cancelledData, provider(), "request_cancelled");
    expect(cancelledData.signatureRequests?.[0]?.status).toBe("cancelled");
  });

  it("executes exactly once, locks artefact references and emits one domain event", async () => {
    const franchiseData = await approvedAgreementData();
    const recorder = audit();
    await sendAgreementForSignature(hqContext(), permissionData, recorder, franchiseData, provider(), {
      requestId: "request_1",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_1")
    });
    await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_1",
      requestId: "request_1",
      eventType: "signer.completed",
      signerId: "request_1-franchisee"
    });
    await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_2",
      requestId: "request_1",
      eventType: "signer.completed",
      signerId: "request_1-franchisor"
    });
    await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_completed",
      requestId: "request_1",
      eventType: "completed",
      signedAgreementArtifact: signedArtifact("signed_1"),
      completionCertificateArtifact: certificateArtifact("cert_1")
    });
    await recordSignatureProviderEvent(hqContext(), permissionData, recorder, franchiseData, {
      eventId: "event_completed",
      requestId: "request_1",
      eventType: "completed",
      signedAgreementArtifact: signedArtifact("signed_2"),
      completionCertificateArtifact: certificateArtifact("cert_2")
    });

    const agreement = franchiseData.franchiseAgreements?.[0];
    expect(agreement?.status).toBe("executed");
    expect(franchiseData.domainEvents?.filter((event) => event.eventType === "franchise.agreement.executed")).toHaveLength(1);
    expect(franchiseData.artifactReferences?.map((artifact) => artifact.lockedAt)).toEqual([
      expect.any(String),
      expect.any(String)
    ]);
    expect(recorder.events.map((event) => event.action)).toContain(
      auditActions.franchiseAgreementExecuted
    );
  });

  it("preserves historical signing request when reissued", async () => {
    const franchiseData = await approvedAgreementData();
    await sendAgreementForSignature(hqContext(), permissionData, audit(), franchiseData, provider(), {
      requestId: "request_old",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_old")
    });
    await cancelSignatureRequest(hqContext(), permissionData, audit(), franchiseData, provider(), "request_old");
    await reissueSignatureRequest(hqContext(), permissionData, audit(), franchiseData, provider(), {
      oldRequestId: "request_old",
      newRequestId: "request_new",
      signers: signerPlan("request_new")
    });

    expect(franchiseData.signatureRequests?.map((request) => request.id)).toEqual([
      "request_old",
      "request_new"
    ]);
  });

  it("displays live signing state in Franchisee 360", async () => {
    const franchiseData = await approvedAgreementData();
    await sendAgreementForSignature(hqContext(), permissionData, audit(), franchiseData, provider(), {
      requestId: "request_1",
      agreementId: ids.agreements.draft,
      signers: signerPlan("request_1")
    });

    const view = getFranchise360(hqContext(), permissionData, franchiseData, ids.franchises.own);
    expect(view.agreement?.signatureRequest?.status).toBe("sent");
    expect(view.agreement?.signers).toHaveLength(2);
  });
});

function hqContext() {
  return {
    userId: ids.users.hq,
    organisationId: ids.organisations.hq
  };
}

function agreementGrant(id: string, action: string) {
  return {
    roleId: ids.roles.hq,
    permission: {
      id,
      module: "franchise.agreement",
      action
    },
    scope: "network" as const
  };
}

function documentGrant(id: string, action: string) {
  return {
    roleId: ids.roles.hq,
    permission: {
      id,
      module: "franchise.document",
      action
    },
    scope: "network" as const
  };
}

function complianceGrant(id: string, action: string) {
  return {
    roleId: ids.roles.hq,
    permission: {
      id,
      module: "franchise.compliance",
      action
    },
    scope: "network" as const
  };
}

async function approvedAgreementData() {
  const franchiseData = data();
  await generateAgreement(hqContext(), permissionData, audit(), franchiseData, {
    id: ids.agreements.draft,
    franchiseId: ids.franchises.own,
    agreementVersionId: ids.agreements.version,
    mergeVariables: {
      territoryName: "Sutton Coldfield",
      ownerName: "Owner"
    }
  });
  await submitAgreementForApproval(hqContext(), permissionData, audit(), franchiseData, ids.agreements.draft);
  await approveAgreement(hqContext(), permissionData, audit(), franchiseData, ids.agreements.draft);
  return franchiseData;
}

function signerPlan(requestId: string) {
  return [
    {
      id: `${requestId}-franchisee`,
      role: "franchisee" as const,
      userId: ids.users.owner,
      name: "Owner",
      email: "owner@example.com",
      signingOrder: 1,
      required: true
    },
    {
      id: `${requestId}-franchisor`,
      role: "franchisor" as const,
      userId: ids.users.hq,
      name: "HQ",
      email: "hq@example.com",
      signingOrder: 2,
      required: true
    }
  ];
}

function provider() {
  return {
    key: "test",
    async send(input: { agreementId: string }) {
      return { providerRequestId: `provider-${input.agreementId}` };
    },
    async resend() {
      return {};
    },
    async cancel() {
      return {};
    }
  };
}

function signedArtifact(id: string) {
  return {
    id,
    franchiseId: ids.franchises.own,
    entityType: "franchise_agreement",
    entityId: ids.agreements.draft,
    category: "signed_agreement" as const,
    label: "Signed agreement",
    storageKey: `agreements/${id}.pdf`
  };
}

function certificateArtifact(id: string) {
  return {
    id,
    franchiseId: ids.franchises.own,
    entityType: "franchise_agreement",
    entityId: ids.agreements.draft,
    category: "completion_certificate" as const,
    label: "Certificate",
    storageKey: `agreements/${id}-certificate.pdf`
  };
}

function documentRecord(id: string, currentVersionId: string) {
  return {
    id,
    franchiseId: ids.franchises.own,
    organisationId: ids.organisations.franchise,
    territoryId: ids.territories.own,
    category: "company_document",
    documentType: "welcome_pack",
    title: "Welcome Pack",
    description: "Franchise document vault seed.",
    status: "active" as const,
    currentVersionId,
    expiryDate: "2027-08-10",
    uploadedByUserId: ids.users.hq
  };
}

function documentVersion(
  id: string,
  documentId: string,
  versionNumber: number,
  artifactReferenceId: string
) {
  return {
    id,
    documentId,
    versionNumber,
    artifactReferenceId,
    uploadedByUserId: ids.users.hq,
    uploadedAt: "2026-08-10"
  };
}

function documentArtifact(id: string, documentId: string) {
  return {
    id,
    franchiseId: ids.franchises.own,
    entityType: "franchise_document",
    entityId: documentId,
    category: "vault_document" as const,
    label: "Franchise document",
    storageKey: `documents/${id}.pdf`
  };
}

function franchise(input: Partial<FranchiseRecord>): FranchiseRecord {
  return {
    id: "franchise",
    franchiseOrganisationId: ids.organisations.franchise,
    primaryTerritoryId: ids.territories.own,
    primaryOwnerUserId: ids.users.owner,
    status: "active",
    lifecycleStage: "trading",
    launchDate: "2024-09-01",
    renewalDate: "2027-09-01",
    onboardingStatus: "complete",
    supportStatus: "standard",
    tags: [],
    ...input
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

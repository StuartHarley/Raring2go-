import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  agreementTemplates,
  agreementVersions,
  agreementSignatureEvents,
  agreementSignatureRequests,
  agreementSigners,
  auditEvents,
  franchiseArtifactReferences,
  franchiseAgreements,
  franchiseDomainEvents,
  franchises,
  organisations,
  territories,
  users
} from "./schema";

describe("foundation schema", () => {
  it("uses global unique email for the shared identity model", () => {
    expect(users.email.name).toBe("email");
  });

  it("keeps audit entity references durable and not foreign-keyed", () => {
    expect(auditEvents.entityType.name).toBe("entity_type");
    expect(auditEvents.entityId.name).toBe("entity_id");

    const migration = readFileSync("migrations/0000_faulty_plazm.sql", "utf8");

    expect(migration).toContain('"entity_type" text NOT NULL');
    expect(migration).toContain('"entity_id" uuid');
    expect(migration).not.toMatch(
      /ALTER TABLE "audit_events".*FOREIGN KEY \("entity_id"\)/
    );
  });

  it("distinguishes organisation and territory scoping columns", () => {
    expect(organisations.id.name).toBe("id");
    expect(territories.franchiseOrganisationId.name).toBe(
      "franchise_organisation_id"
    );
  });

  it("models franchise relationships through existing organisation and territory records", () => {
    expect(franchises.franchiseOrganisationId.name).toBe("franchise_organisation_id");
    expect(franchises.primaryTerritoryId.name).toBe("primary_territory_id");
    expect(franchises.primaryOwnerUserId.name).toBe("primary_owner_user_id");
    expect((franchises as unknown as Record<string, unknown>).legalName).toBeUndefined();
    expect((franchises as unknown as Record<string, unknown>).companyNumber).toBeUndefined();
    expect((franchises as unknown as Record<string, unknown>).vatNumber).toBeUndefined();
  });

  it("separates agreement templates, versions and generated franchise instances", () => {
    expect(agreementTemplates.key.name).toBe("key");
    expect(agreementVersions.templateId.name).toBe("template_id");
    expect(franchiseAgreements.agreementVersionId.name).toBe("agreement_version_id");
    expect(franchiseAgreements.mergeVariables.name).toBe("merge_variables");
  });

  it("models provider-neutral signing artefacts and events without a document vault", () => {
    expect(agreementSignatureRequests.providerKey.name).toBe("provider_key");
    expect(agreementSigners.signingOrder.name).toBe("signing_order");
    expect(agreementSignatureEvents.providerEventId.name).toBe("provider_event_id");
    expect(franchiseArtifactReferences.storageKey.name).toBe("storage_key");
    expect(franchiseDomainEvents.idempotencyKey.name).toBe("idempotency_key");
    expect((franchiseArtifactReferences as unknown as Record<string, unknown>).folderId).toBeUndefined();
  });
});

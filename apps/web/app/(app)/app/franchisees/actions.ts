"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createFranchiseFromInput,
  addDocumentVersionForFranchise,
  approveCurrentAgreement,
  archiveDocumentForFranchise,
  cancelCurrentSignatureRequest,
  completeCurrentAgreementSigning,
  completeNextSignerForCurrentAgreement,
  declineCurrentAgreementSigning,
  generateAgreementForFranchise,
  resendCurrentSignatureRequest,
  sendCurrentAgreementForSignature,
  submitCurrentAgreement,
  submitComplianceEvidenceForFranchise,
  upsertInsuranceForFranchise,
  uploadDocumentForFranchise,
  verifyComplianceForFranchise,
  verifyInsuranceForFranchise,
  voidCurrentAgreement,
  updateFranchiseFromInput
} from "../../../../lib/franchise-runtime";
import type { FranchiseActorContext, FranchiseRecord } from "@raring2go/franchise";

export async function createFranchiseAction(
  context: FranchiseActorContext,
  formData: FormData
) {
  const franchise: FranchiseRecord = {
    id: randomUUID(),
    franchiseOrganisationId: String(formData.get("organisationId") ?? ""),
    primaryTerritoryId: String(formData.get("territoryId") ?? ""),
    primaryOwnerUserId: String(formData.get("ownerUserId") || "") || null,
    status: "active",
    lifecycleStage: "trading",
    launchDate: String(formData.get("launchDate") || "") || null,
    renewalDate: String(formData.get("renewalDate") || "") || null,
    onboardingStatus: "not_started",
    supportStatus: "standard",
    tags: []
  };

  await createFranchiseFromInput(context, franchise);
  revalidatePath("/app/franchisees");
}

export async function updateFranchiseAction(
  context: FranchiseActorContext,
  franchiseId: string,
  formData: FormData
) {
  await updateFranchiseFromInput(context, franchiseId, {
    lifecycleStage: String(
      formData.get("lifecycleStage") ?? "trading"
    ) as FranchiseRecord["lifecycleStage"],
    onboardingStatus: String(formData.get("onboardingStatus") ?? "not_started"),
    supportStatus: String(formData.get("supportStatus") ?? "standard"),
    renewalDate: String(formData.get("renewalDate") || "") || null
  });

  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function generateAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await generateAgreementForFranchise(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function submitAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await submitCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function approveAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await approveCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function voidAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await voidCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function sendAgreementForSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await sendCurrentAgreementForSignature(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function resendSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await resendCurrentSignatureRequest(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function cancelSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await cancelCurrentSignatureRequest(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function completeNextSignerAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await completeNextSignerForCurrentAgreement(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function completeSigningAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await completeCurrentAgreementSigning(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function declineSigningAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await declineCurrentAgreementSigning(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function uploadDocumentAction(
  context: FranchiseActorContext,
  franchiseId: string,
  formData: FormData
) {
  await uploadDocumentForFranchise(context, franchiseId, {
    documentId: randomUUID(),
    versionId: randomUUID(),
    artifactId: randomUUID(),
    category: String(formData.get("category") || "company_document"),
    documentType: String(formData.get("documentType") || "general"),
    title: String(formData.get("title") || "Untitled document"),
    description: String(formData.get("description") || "") || null,
    expiryDate: String(formData.get("expiryDate") || "") || null
  });
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function addDocumentVersionAction(
  context: FranchiseActorContext,
  franchiseId: string,
  documentId: string
) {
  await addDocumentVersionForFranchise(
    context,
    franchiseId,
    documentId,
    randomUUID(),
    randomUUID()
  );
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function archiveDocumentAction(
  context: FranchiseActorContext,
  franchiseId: string,
  documentId: string
) {
  await archiveDocumentForFranchise(context, franchiseId, documentId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function upsertInsuranceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  formData: FormData
) {
  await upsertInsuranceForFranchise(context, franchiseId, {
    policyId: String(formData.get("policyId") || "") || randomUUID(),
    provider: String(formData.get("provider") || "Unknown provider"),
    policyNumber: String(formData.get("policyNumber") || "Unknown policy"),
    coverTypes: String(formData.get("coverTypes") || "public_liability")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    coverStartDate: String(formData.get("coverStartDate") || ""),
    coverEndDate: String(formData.get("coverEndDate") || ""),
    evidenceDocumentId: String(formData.get("evidenceDocumentId") || "") || null
  });
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function verifyInsuranceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  policyId: string
) {
  await verifyInsuranceForFranchise(context, franchiseId, policyId, "verified");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function rejectInsuranceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  policyId: string
) {
  await verifyInsuranceForFranchise(context, franchiseId, policyId, "rejected");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function submitComplianceEvidenceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  requirementId: string,
  formData: FormData
) {
  await submitComplianceEvidenceForFranchise(context, franchiseId, {
    recordId: String(formData.get("recordId") || "") || randomUUID(),
    requirementId,
    evidenceDocumentId: String(formData.get("evidenceDocumentId") || "") || null,
    expiresAt: String(formData.get("expiresAt") || "") || null
  });
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function verifyComplianceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  recordId: string
) {
  await verifyComplianceForFranchise(context, franchiseId, recordId, "complete");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function rejectComplianceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  recordId: string
) {
  await verifyComplianceForFranchise(context, franchiseId, recordId, "rejected");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

"use server";

import { assertBoundActor } from "../../../../lib/action-actor";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createFranchiseFromInput,
  addDocumentVersionForFranchise,
  approveCurrentAgreement,
  approveLaunchForFranchise,
  approveOnboardingTaskForFranchise,
  archiveDocumentForFranchise,
  changeOnboardingTargetForFranchise,
  cancelCurrentSignatureRequest,
  completeCurrentAgreementSigning,
  completeNextSignerForCurrentAgreement,
  completeOnboardingTaskForFranchise,
  declineCurrentAgreementSigning,
  ensureComplianceActionsForFranchise,
  generateAgreementForFranchise,
  resendCurrentSignatureRequest,
  resolveComplianceActionForFranchise,
  raiseOnboardingBlockerForFranchise,
  resolveOnboardingBlockerForFranchise,
  sendCurrentAgreementForSignature,
  startOnboardingForFranchise,
  submitCurrentAgreement,
  submitComplianceEvidenceForFranchise,
  upsertInsuranceForFranchise,
  uploadDocumentForFranchise,
  verifyComplianceForFranchise,
  verifyInsuranceForFranchise,
  markLaunchedForFranchise,
  voidCurrentAgreement,
  updateFranchiseFromInput
} from "../../../../lib/franchise-runtime";
import type { FranchiseActorContext, FranchiseRecord } from "@raring2go/franchise";

export async function createFranchiseAction(
  context: FranchiseActorContext,
  formData: FormData
) {
  await assertBoundActor(context);
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
  await assertBoundActor(context);
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
  await assertBoundActor(context);
  await generateAgreementForFranchise(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function submitAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await submitCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function approveAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await approveCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function voidAgreementAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await voidCurrentAgreement(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function sendAgreementForSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await sendCurrentAgreementForSignature(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function resendSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await resendCurrentSignatureRequest(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function cancelSignatureAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await cancelCurrentSignatureRequest(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function completeNextSignerAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await completeNextSignerForCurrentAgreement(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function completeSigningAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await completeCurrentAgreementSigning(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function declineSigningAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await declineCurrentAgreementSigning(context, franchiseId, randomUUID());
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function archiveDocumentAction(
  context: FranchiseActorContext,
  franchiseId: string,
  documentId: string
) {
  await assertBoundActor(context);
  await archiveDocumentForFranchise(context, franchiseId, documentId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function upsertInsuranceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  formData: FormData
) {
  await assertBoundActor(context);
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
  await assertBoundActor(context);
  await verifyInsuranceForFranchise(context, franchiseId, policyId, "verified");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function rejectInsuranceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  policyId: string
) {
  await assertBoundActor(context);
  await verifyInsuranceForFranchise(context, franchiseId, policyId, "rejected");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function submitComplianceEvidenceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  requirementId: string,
  formData: FormData
) {
  await assertBoundActor(context);
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
  await assertBoundActor(context);
  await verifyComplianceForFranchise(context, franchiseId, recordId, "complete");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function rejectComplianceAction(
  context: FranchiseActorContext,
  franchiseId: string,
  recordId: string
) {
  await assertBoundActor(context);
  await verifyComplianceForFranchise(context, franchiseId, recordId, "rejected");
  revalidatePath(`/app/franchisees/${franchiseId}`);
}

export async function ensureComplianceActionsAction(
  context: FranchiseActorContext,
  franchiseId: string
) {
  await assertBoundActor(context);
  await ensureComplianceActionsForFranchise(context, franchiseId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees");
}

export async function resolveComplianceActionAction(
  context: FranchiseActorContext,
  franchiseId: string,
  actionId: string
) {
  await assertBoundActor(context);
  await resolveComplianceActionForFranchise(context, franchiseId, actionId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees");
}

export async function startOnboardingAction(
  context: FranchiseActorContext,
  franchiseId: string,
  formData: FormData
) {
  await assertBoundActor(context);
  await startOnboardingForFranchise(
    context,
    franchiseId,
    String(formData.get("targetLaunchDate") || "2026-11-01")
  );
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function completeOnboardingTaskAction(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string
) {
  await assertBoundActor(context);
  await completeOnboardingTaskForFranchise(context, franchiseId, taskId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function approveOnboardingTaskAction(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string
) {
  await assertBoundActor(context);
  await approveOnboardingTaskForFranchise(context, franchiseId, taskId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function raiseOnboardingBlockerAction(
  context: FranchiseActorContext,
  franchiseId: string,
  taskId: string,
  formData: FormData
) {
  await assertBoundActor(context);
  await raiseOnboardingBlockerForFranchise(context, franchiseId, taskId, {
    title: String(formData.get("title") || "Launch blocker"),
    notes: String(formData.get("notes") || "")
  });
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function resolveOnboardingBlockerAction(
  context: FranchiseActorContext,
  franchiseId: string,
  blockerId: string
) {
  await assertBoundActor(context);
  await resolveOnboardingBlockerForFranchise(context, franchiseId, blockerId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function changeOnboardingTargetAction(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string,
  formData: FormData
) {
  await assertBoundActor(context);
  await changeOnboardingTargetForFranchise(
    context,
    franchiseId,
    programmeId,
    String(formData.get("targetLaunchDate") || "")
  );
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function approveLaunchAction(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string
) {
  await assertBoundActor(context);
  await approveLaunchForFranchise(context, franchiseId, programmeId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

export async function markLaunchedAction(
  context: FranchiseActorContext,
  franchiseId: string,
  programmeId: string
) {
  await assertBoundActor(context);
  await markLaunchedForFranchise(context, franchiseId, programmeId);
  revalidatePath(`/app/franchisees/${franchiseId}`);
  revalidatePath("/app/franchisees/onboarding");
}

"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createFranchiseFromInput,
  approveCurrentAgreement,
  cancelCurrentSignatureRequest,
  completeCurrentAgreementSigning,
  completeNextSignerForCurrentAgreement,
  declineCurrentAgreementSigning,
  generateAgreementForFranchise,
  resendCurrentSignatureRequest,
  sendCurrentAgreementForSignature,
  submitCurrentAgreement,
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

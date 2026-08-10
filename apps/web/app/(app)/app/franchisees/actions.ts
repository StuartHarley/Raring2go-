"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  createFranchiseFromInput,
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

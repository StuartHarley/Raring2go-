"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  approveStatement,
  createRoyaltyRule,
  generateStatement,
  recordAdjustment,
  submitStatement
} from "../../../../lib/finance-runtime";
import type { FinanceActorContext } from "@raring2go/finance";

export async function createRoyaltyRuleAction(
  context: FinanceActorContext,
  formData: FormData
) {
  const minimumDueValue = String(formData.get("minimumDueMinor") || "0");

  await createRoyaltyRule(context, {
    id: randomUUID(),
    franchiseId: String(formData.get("franchiseId") || ""),
    revenueBasis: String(formData.get("revenueBasis") || "collected") as "invoiced" | "collected",
    rateBps: Number(formData.get("rateBps") || 0),
    minimumDueMinor: Number(minimumDueValue) || 0,
    effectiveFrom: String(formData.get("effectiveFrom") || ""),
    notes: String(formData.get("notes") || "") || null
  });

  revalidatePath("/app/finance");
}

export async function generateStatementAction(
  context: FinanceActorContext,
  issuerOrganisationId: string,
  formData: FormData
) {
  await generateStatement(context, {
    id: randomUUID(),
    franchiseId: String(formData.get("franchiseId") || ""),
    issuerOrganisationId,
    periodStart: String(formData.get("periodStart") || ""),
    periodEnd: String(formData.get("periodEnd") || "")
  });

  revalidatePath("/app/finance");
}

export async function addAdjustmentAction(
  context: FinanceActorContext,
  statementId: string,
  formData: FormData
) {
  const amountPounds = Number(formData.get("amountMinor") || 0);

  await recordAdjustment(context, {
    id: randomUUID(),
    statementId,
    amountMinor: Math.round(amountPounds * 100),
    reason: String(formData.get("reason") || "")
  });

  revalidatePath("/app/finance");
}

export async function submitStatementAction(
  context: FinanceActorContext,
  statementId: string
) {
  await submitStatement(context, statementId);
  revalidatePath("/app/finance");
}

export async function approveStatementAction(
  context: FinanceActorContext,
  statementId: string
) {
  await approveStatement(context, statementId);
  revalidatePath("/app/finance");
}

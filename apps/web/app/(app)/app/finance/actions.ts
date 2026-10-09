"use server";

import { assertBoundActor } from "../../../../lib/action-actor";
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
  await assertBoundActor(context);
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
  formData: FormData
) {
  await assertBoundActor(context);
  await generateStatement(context, {
    id: randomUUID(),
    franchiseId: String(formData.get("franchiseId") || ""),
    // The statement is issued by the organisation the (authorised) actor is acting for.
    issuerOrganisationId: context.organisationId,
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
  await assertBoundActor(context);
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
  await assertBoundActor(context);
  await submitStatement(context, statementId);
  revalidatePath("/app/finance");
}

export async function approveStatementAction(
  context: FinanceActorContext,
  statementId: string
) {
  await assertBoundActor(context);
  await approveStatement(context, statementId);
  revalidatePath("/app/finance");
}

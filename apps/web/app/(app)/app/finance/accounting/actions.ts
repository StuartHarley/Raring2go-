"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { retryAccountingSync, setTaxRateRecord } from "../../../../../lib/finance-config-runtime";

/** Fixed result codes only; the banner text is looked up on the page. */
export type AccountingResult = "rate_saved" | "rate_invalid" | "rate_not_allowed" | "retry_queued" | "not_found";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser.tax_rate", action: "manage" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result: AccountingResult): never {
  revalidatePath("/app/finance/accounting");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/finance/accounting?${query.toString()}` as Route);
}

export async function setTaxRateAction(request: RequestedShellContext, formData: FormData) {
  let result: AccountingResult = "rate_saved";
  try {
    await setTaxRateRecord(await actorFor(request), {
      code: String(formData.get("code") ?? ""),
      description: String(formData.get("description") ?? ""),
      rateBps: Math.round(Number(formData.get("ratePercent")) * 100),
      effectiveFrom: String(formData.get("effectiveFrom") ?? "")
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (/tax code|between 0%|YYYY-MM-DD|start after/i.test(error.message)) result = "rate_invalid";
    else if (/not allowed|permission/i.test(error.message)) result = "rate_not_allowed";
    else throw error;
  }
  back(request, result);
}

export async function retryAccountingSyncAction(request: RequestedShellContext, referenceId: string) {
  let result: AccountingResult = "retry_queued";
  try {
    await retryAccountingSync(await actorFor(request), referenceId);
  } catch (error) {
    if (error instanceof Error && /not found/i.test(error.message)) result = "not_found";
    else throw error;
  }
  back(request, result);
}

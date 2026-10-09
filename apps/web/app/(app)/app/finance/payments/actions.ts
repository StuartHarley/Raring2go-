"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { requireShellPermission } from "../../../../../lib/app-shell";
import type { RequestedShellContext } from "../../../../../lib/app-shell";
import { PaymentNotAvailableError, PaymentRateLimitedError, PAYMENT_PROVIDERS, createPaymentLinkAsStaff, emailPaymentLink } from "../../../../../lib/payments-runtime";
import type { PaymentProviderKey } from "../../../../../lib/payments-runtime";

/** Fixed result codes only; banner text is looked up on the page. The acting franchise comes from the session. */
export type PaymentsResult = "rate_limited" | "link_created" | "link_reused" | "emailed" | "email_failed" | "no_contact" | "not_available" | "not_allowed" | "invalid";

async function actorFor(request: RequestedShellContext) {
  const shell = await requireShellPermission(request, { module: "advertiser.payment", action: "request" });
  return { userId: shell.userId, organisationId: shell.activeContext.organisationId, territoryId: shell.activeContext.territoryId };
}

function back(request: RequestedShellContext, result: PaymentsResult): never {
  revalidatePath("/app/finance/payments");
  const query = new URLSearchParams({ result });
  if (request.sessionKey) query.set("session", request.sessionKey);
  if (request.organisationId) query.set("organisationId", request.organisationId);
  if (request.territoryId) query.set("territoryId", request.territoryId);
  redirect(`/app/finance/payments?${query.toString()}` as Route);
}

function resultFor(error: unknown): PaymentsResult {
  if (error instanceof PaymentNotAvailableError) return "not_available";
  if (error instanceof PaymentRateLimitedError) return "rate_limited";
  if (error instanceof Error && /Only an issued invoice|nothing left to pay|not found|outside/i.test(error.message)) return "invalid";
  if (error instanceof Error && /permission|No permission/i.test(error.message)) return "not_allowed";
  throw error;
}

export async function createPaymentLinkAction(request: RequestedShellContext, invoiceId: string, provider: string) {
  if (!PAYMENT_PROVIDERS.includes(provider as PaymentProviderKey)) back(request, "invalid");
  let result: PaymentsResult = "link_created";
  try {
    const link = await createPaymentLinkAsStaff(await actorFor(request), invoiceId, provider as PaymentProviderKey);
    if (link.reused) result = "link_reused";
  } catch (error) {
    result = resultFor(error);
  }
  back(request, result);
}

export async function emailPaymentLinkAction(request: RequestedShellContext, invoiceId: string, provider: string) {
  if (!PAYMENT_PROVIDERS.includes(provider as PaymentProviderKey)) back(request, "invalid");
  let result: PaymentsResult = "emailed";
  try {
    const outcome = await emailPaymentLink(await actorFor(request), invoiceId, provider as PaymentProviderKey);
    result = outcome.emailed ? "emailed" : outcome.noContact ? "no_contact" : "email_failed";
  } catch (error) {
    result = resultFor(error);
  }
  back(request, result);
}

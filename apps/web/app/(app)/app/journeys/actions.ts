"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { validateJourneyConditions, validateJourneySteps, validateJourneyTrigger } from "@raring2go/marketing";
import type { MarketingActorContext } from "@raring2go/marketing";
import {
  activateMarketingJourney,
  approveMarketingJourneyVersion,
  createMarketingJourney,
  pauseMarketingJourney,
  updateMarketingJourneyDraft
} from "../../../../lib/marketing-runtime";

function parseJourneyContentFields(formData: FormData) {
  const trigger = validateJourneyTrigger({ type: String(formData.get("trigger") || "") });

  let parsedConditions: unknown;
  try {
    parsedConditions = JSON.parse(String(formData.get("conditionsJson") || "[]"));
  } catch {
    throw new Error("The journey's conditions could not be read. Try editing them again.");
  }
  const conditions = validateJourneyConditions(parsedConditions);

  let parsedSteps: unknown;
  try {
    parsedSteps = JSON.parse(String(formData.get("stepsJson") || "[]"));
  } catch {
    throw new Error("The journey's steps could not be read. Try editing them again.");
  }
  const steps = validateJourneySteps(parsedSteps);

  return { trigger, conditions, steps };
}

export async function createJourneyAction(context: MarketingActorContext, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    throw new Error("Name the journey before creating it.");
  }
  const { trigger, conditions, steps } = parseJourneyContentFields(formData);
  const territoryId = String(formData.get("territoryId") || "") || null;

  await createMarketingJourney(context, {
    journeyId: randomUUID(),
    versionId: randomUUID(),
    key: randomUUID(),
    name,
    territoryId,
    purpose: "marketing",
    description: String(formData.get("description") || "").trim() || null,
    trigger,
    conditions,
    steps
  });

  revalidatePath("/app/journeys");
}

export async function updateJourneyDraftAction(context: MarketingActorContext, journeyId: string, formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) {
    throw new Error("Name the journey before saving it.");
  }
  const { trigger, conditions, steps } = parseJourneyContentFields(formData);

  await updateMarketingJourneyDraft(context, journeyId, {
    name,
    description: String(formData.get("description") || "").trim() || null,
    trigger,
    conditions,
    steps
  });

  revalidatePath("/app/journeys");
  revalidatePath(`/app/journeys/${journeyId}`);
}

export async function approveJourneyAction(context: MarketingActorContext, journeyId: string, versionId: string) {
  await approveMarketingJourneyVersion(context, journeyId, versionId);
  revalidatePath("/app/journeys");
  revalidatePath(`/app/journeys/${journeyId}`);
}

export async function activateJourneyAction(context: MarketingActorContext, journeyId: string) {
  await activateMarketingJourney(context, journeyId);
  revalidatePath("/app/journeys");
  revalidatePath(`/app/journeys/${journeyId}`);
}

export async function pauseJourneyAction(context: MarketingActorContext, journeyId: string) {
  await pauseMarketingJourney(context, journeyId);
  revalidatePath("/app/journeys");
  revalidatePath(`/app/journeys/${journeyId}`);
}

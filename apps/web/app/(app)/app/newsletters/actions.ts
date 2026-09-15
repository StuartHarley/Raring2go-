"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { renderBlocksToText, sanitizeImportedHtml, sanitizeRichTextHtml, validateBlocks } from "@raring2go/marketing";
import type { Block } from "@raring2go/marketing";
import {
  addNewsletterEditionOverride,
  approveCampaignVersion,
  approveNewsletterMaster,
  composeEmailCampaign,
  createCampaignFromEdition,
  createNewsletterMaster,
  generateCampaignRecipientSnapshot,
  generateNewsletterEditions,
  scheduleCampaign,
  sendCampaignNow
} from "../../../../lib/marketing-runtime";
import type { MarketingActorContext } from "@raring2go/marketing";

export async function composeEmailCampaignAction(context: MarketingActorContext, formData: FormData) {
  const segmentId = String(formData.get("segmentId") || "");

  if (!segmentId) {
    throw new Error("Select an audience segment before composing a campaign.");
  }

  const blocksJson = String(formData.get("blocksJson") || "");
  let parsedBlocks: unknown;

  try {
    parsedBlocks = JSON.parse(blocksJson);
  } catch {
    throw new Error("The newsletter content could not be read. Try composing it again.");
  }

  // The trust boundary: blocksJson is client-authored JSON (the block editor's
  // serialized state, including anything pasted/uploaded through "Import HTML")
  // and must never be accepted as-is. validateBlocks rejects unknown block
  // types/shapes and unsafe URL schemes; every TextBlock's rich-text HTML and
  // every imported RawHtmlBlock's HTML is then sanitized server-side regardless
  // of what the client already did.
  const blocks: Block[] = validateBlocks(parsedBlocks).map((block) => {
    if (block.type === "text") return { ...block, html: sanitizeRichTextHtml(block.html) };
    if (block.type === "raw-html") return { ...block, html: sanitizeImportedHtml(block.html) };
    return block;
  });

  if (blocks.length === 0 || !renderBlocksToText(blocks).trim()) {
    throw new Error("Write the newsletter content before composing a campaign.");
  }

  const sendChoice = String(formData.get("sendChoice") || "postmark");
  const [sendProviderChoice, sendConnectionIdChoice] = sendChoice.split(":");
  const sendProvider = sendProviderChoice === "microsoft" ? "microsoft" : "postmark";
  const sendConnectionId = sendProvider === "microsoft" ? sendConnectionIdChoice || null : null;

  await composeEmailCampaign(context, {
    campaignId: randomUUID(),
    versionId: randomUUID(),
    segmentId,
    title: String(formData.get("title") || "Newsletter"),
    subject: String(formData.get("subject") || ""),
    preheader: String(formData.get("preheader") || "") || null,
    blocks,
    sendProvider,
    sendConnectionId
  });

  revalidatePath("/app/newsletters");
}

export async function approveCampaignAction(context: MarketingActorContext, campaignId: string, versionId: string) {
  await approveCampaignVersion(context, campaignId, versionId);
  revalidatePath("/app/newsletters");
  revalidatePath("/app/newsletters/factory");
}

export async function generateSnapshotAction(context: MarketingActorContext, campaignId: string) {
  await generateCampaignRecipientSnapshot(context, campaignId);
  revalidatePath("/app/newsletters");
  revalidatePath("/app/newsletters/factory");
}

export async function scheduleCampaignAction(context: MarketingActorContext, campaignId: string, formData: FormData) {
  const scheduledAt = String(formData.get("scheduledAt") || "");

  if (!scheduledAt) {
    throw new Error("Choose a date and time to schedule this campaign.");
  }

  await scheduleCampaign(context, campaignId, new Date(scheduledAt).toISOString());
  revalidatePath("/app/newsletters");
  revalidatePath("/app/newsletters/factory");
}

export async function sendCampaignAction(context: MarketingActorContext, campaignId: string) {
  await sendCampaignNow(context, campaignId);
  revalidatePath("/app/newsletters");
  revalidatePath("/app/newsletters/factory");
}

export async function createNewsletterMasterAction(context: MarketingActorContext, formData: FormData) {
  await createNewsletterMaster(context, {
    masterId: randomUUID(),
    title: String(formData.get("title") || "Network newsletter"),
    seasonKey: String(formData.get("seasonKey") || "") || null,
    requireLocalContent: formData.get("requireLocalContent") === "on"
  });

  revalidatePath("/app/newsletters/factory");
}

export async function approveMasterAction(context: MarketingActorContext, masterId: string) {
  await approveNewsletterMaster(context, masterId);
  revalidatePath("/app/newsletters/factory");
}

export async function generateEditionsAction(context: MarketingActorContext, masterId: string, formData: FormData) {
  const territoryIds = formData.getAll("territoryIds").map(String).filter(Boolean);

  if (territoryIds.length === 0) {
    throw new Error("Select at least one territory to generate editions for.");
  }

  await generateNewsletterEditions(context, masterId, territoryIds);
  revalidatePath("/app/newsletters/factory");
}

export async function addEditionOverrideAction(context: MarketingActorContext, editionId: string, formData: FormData) {
  const text = String(formData.get("localPicks") || "");

  await addNewsletterEditionOverride(context, editionId, {
    "local-picks": text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((title) => ({ title }))
  });

  revalidatePath("/app/newsletters/factory");
}

export async function createCampaignFromEditionAction(
  context: MarketingActorContext,
  editionId: string,
  segmentId: string,
  formData: FormData
) {
  if (!segmentId) {
    throw new Error("No audience segment is configured for this territory yet.");
  }

  await createCampaignFromEdition(context, {
    editionId,
    campaignId: randomUUID(),
    versionId: randomUUID(),
    segmentId,
    subject: String(formData.get("subject") || ""),
    preheader: String(formData.get("preheader") || "") || null
  });

  revalidatePath("/app/newsletters/factory");
  revalidatePath("/app/newsletters");
}

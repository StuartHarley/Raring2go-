/**
 * Classify an uploaded artwork file from facts we actually have: type, size, dimensions and its filename. This
 * is a rules-based classifier, not a model: it is fast, explainable and reproducible, and it says how sure it
 * is. Where it cannot tell, it says so rather than guess.
 */
export type ArtworkFileFacts = {
  fileName: string;
  contentType: string;
  bytes: number;
  widthPx?: number | null;
  heightPx?: number | null;
  /** The slot this file was uploaded for, if known: "full_page", "half_page", "quarter_page", "logo"... */
  intendedSlot?: string | null;
};

export type ArtworkClass = "full_page_ad" | "partial_page_ad" | "logo" | "photograph" | "document" | "unknown";

export type ArtworkClassification = { classification: ArtworkClass; confidence: "high" | "medium" | "low"; reasons: string[]; concerns: string[] };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function classifyArtwork(file: ArtworkFileFacts): ArtworkClassification {
  const reasons: string[] = [];
  const concerns: string[] = [];
  const name = file.fileName.toLowerCase();
  const isPdf = file.contentType === "application/pdf";
  const isImage = IMAGE_TYPES.has(file.contentType);

  if (!isPdf && !isImage) {
    return { classification: "unknown", confidence: "low", reasons: [`${file.contentType || "Unknown file type"} is not a type we print from.`], concerns: ["Ask for a PDF (preferred for print) or a high-resolution PNG/JPEG."] };
  }
  if (file.bytes < 5_000) concerns.push("The file is very small, so it is unlikely to hold print-quality artwork.");

  if (/\blogo\b|logotype|brandmark/.test(name)) {
    reasons.push("The filename says it is a logo.");
    if (isImage && file.widthPx && file.widthPx > 4000) reasons.push("It is large for a logo, so it may be a full artwork saved with a logo name.");
    return { classification: "logo", confidence: isImage && (file.widthPx ?? 0) <= 4000 ? "high" : "medium", reasons, concerns };
  }

  if (isPdf) {
    reasons.push("It is a PDF, the preferred format for print-ready adverts.");
    const slot = file.intendedSlot;
    if (slot === "full_page") return { classification: "full_page_ad", confidence: "medium", reasons: [...reasons, "It was uploaded for a full-page slot."], concerns };
    if (slot && /half|quarter|eighth|strip|banner/.test(slot)) return { classification: "partial_page_ad", confidence: "medium", reasons: [...reasons, `It was uploaded for a ${slot.replace(/_/g, " ")} slot.`], concerns };
    return { classification: "document", confidence: "low", reasons: [...reasons, "Nothing says which slot it is for, so it could be an advert or a supporting document."], concerns };
  }

  const w = file.widthPx;
  const h = file.heightPx;
  if (w && h) {
    const ratio = w / h;
    reasons.push(`The image is ${w} × ${h} px.`);
    if (/\bphoto|img_|dsc_|\.jpe?g$/.test(name) && Math.abs(ratio - 1.5) < 0.2) {
      return { classification: "photograph", confidence: "medium", reasons: [...reasons, "The proportions and filename look like a camera photograph."], concerns };
    }
    if (Math.abs(ratio - 0.707) < 0.06 || Math.abs(ratio - 1.414) < 0.06) {
      return { classification: "full_page_ad", confidence: "medium", reasons: [...reasons, "The proportions match an A-series page."], concerns };
    }
  } else {
    concerns.push("Image dimensions were not recorded, so print size cannot be judged.");
  }
  return { classification: "unknown", confidence: "low", reasons: reasons.length ? reasons : ["There is not enough information to classify this file."], concerns };
}

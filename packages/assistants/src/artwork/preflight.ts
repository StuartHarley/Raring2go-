/**
 * What the print preflight found, in plain English, with a fix verdict that a model can never improve.
 *
 * The preflight engine owns the verdict (`severity`, `fixable`). This knowledge base adds explanation and
 * steps, and a conservative fixability: where either the engine or the knowledge base says an issue cannot be
 * repaired safely, it stays that way. A low-resolution image is never "fixed" by upscaling and called
 * print-safe.
 */
export type PreflightCheckInput = {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  fixable: boolean;
};

export type Fixability = "auto_safe" | "manual" | "needs_new_artwork";

export type PreflightKnowledge = { title: string; why: string; steps: string[]; fixability: Fixability };

export const preflightKnowledge: Record<string, PreflightKnowledge> = {
  colour_space_rgb: {
    title: "Colour is RGB, not CMYK",
    why: "Printers use CMYK inks. RGB artwork is converted at the press, which can shift colours, especially bright blues and greens.",
    steps: ["Convert the artwork to CMYK in a derived copy (the original is kept untouched).", "Check brand colours still look right after conversion.", "Re-run preflight on the converted copy."],
    fixability: "auto_safe"
  },
  low_resolution: {
    title: "Images are below 300 dpi",
    why: "Below 300 dpi, images print soft or pixelated. Enlarging a low-resolution image does not add detail, so it cannot be repaired by software.",
    steps: ["Ask the advertiser for the original, higher-resolution image (300 dpi at the size it will print).", "Do not upscale the existing image: it will still look poor in print.", "Re-upload and run preflight again."],
    fixability: "needs_new_artwork"
  },
  missing_bleed: {
    title: "No bleed",
    why: "Bleed is artwork that runs a few millimetres past the trim edge, so there are no white slivers when the page is cut.",
    steps: ["Extend the background and any edge-to-edge images by the required bleed on a derived copy.", "Keep important text and logos inside the safe area.", "Re-run preflight."],
    fixability: "auto_safe"
  },
  unchecked_links: {
    title: "Digital links not checked",
    why: "Links in digital editions that point nowhere damage trust. Print is unaffected.",
    steps: ["Open each link and confirm it goes where intended.", "Mark the links as checked."],
    fixability: "manual"
  }
};

const GENERIC: PreflightKnowledge = {
  title: "Preflight issue",
  why: "The preflight reported a problem that needs a person to look at it.",
  steps: ["Read the message from the preflight carefully.", "Ask the production team if you are unsure how to resolve it."],
  fixability: "manual"
};

const rank: Record<Fixability, number> = { auto_safe: 0, manual: 1, needs_new_artwork: 2 };
const mostCautious = (a: Fixability, b: Fixability): Fixability => (rank[a] >= rank[b] ? a : b);

export type PreflightItem = {
  code: string;
  severity: PreflightCheckInput["severity"];
  title: string;
  explanation: string;
  steps: string[];
  fixability: Fixability;
  /** The engine's own message, shown so nothing the engine said is hidden. */
  engineMessage: string;
};

export type PreflightAnalysis = {
  items: PreflightItem[];
  /** True only when no error-severity check remains. Computed, never taken from a model. */
  readyForPrint: boolean;
  blockers: number;
  needsNewArtwork: number;
  summary: string;
};

export function analysePreflight(checks: PreflightCheckInput[]): PreflightAnalysis {
  const items = checks.map((check): PreflightItem => {
    const known = preflightKnowledge[check.code] ?? GENERIC;
    // The engine's `fixable: false` and the knowledge base's own verdict both cap what we can claim.
    const fromEngine: Fixability = check.fixable ? "auto_safe" : known.fixability === "needs_new_artwork" ? "needs_new_artwork" : "manual";
    return {
      code: check.code,
      severity: check.severity,
      title: known.title,
      explanation: known.why,
      steps: known.steps,
      fixability: mostCautious(known.fixability, fromEngine),
      engineMessage: check.message
    };
  });

  const blockers = items.filter((item) => item.severity === "error").length;
  const needsNewArtwork = items.filter((item) => item.fixability === "needs_new_artwork").length;
  const readyForPrint = blockers === 0;

  const summary = checks.length === 0
    ? "Preflight found no issues."
    : readyForPrint
      ? `Preflight passed with ${items.length} advisory note${items.length === 1 ? "" : "s"}.`
      : `Preflight failed: ${blockers} blocking issue${blockers === 1 ? "" : "s"}${needsNewArtwork ? `, ${needsNewArtwork} needing replacement artwork` : ""}. This artwork is not ready for print.`;

  return { items, readyForPrint, blockers, needsNewArtwork, summary };
}

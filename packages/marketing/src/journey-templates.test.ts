import { describe, expect, it } from "vitest";
import { findJourneyTemplate, journeyTemplates, validateJourneyTemplate } from "./journey-templates";
import { validateJourneyTrigger } from "./journey-validation";
import { readJourneyFrequencyCap } from "./service";

describe("journey templates", () => {
  it("are all valid through the same validators as user-supplied journeys", () => {
    for (const template of journeyTemplates) {
      expect(() => validateJourneyTemplate(template), template.key).not.toThrow();
    }
  });

  it("each carry an explicit, valid frequency cap rather than relying on the default", () => {
    for (const template of journeyTemplates) {
      expect(readJourneyFrequencyCap({ frequencyCap: template.frequencyCap }), template.key).toEqual(template.frequencyCap);
    }
  });

  it("send the welcome as transactional and nothing else", () => {
    expect(findJourneyTemplate("welcome")!.steps[0]).toMatchObject({ transactional: true });
    for (const template of journeyTemplates.filter((candidate) => candidate.key !== "welcome")) {
      expect(template.steps.some((step) => step.transactional), template.key).toBe(false);
    }
  });

  it("have unique keys and step keys", () => {
    expect(new Set(journeyTemplates.map((template) => template.key)).size).toBe(journeyTemplates.length);
    for (const template of journeyTemplates) expect(new Set(template.steps.map((step) => step.key)).size).toBe(template.steps.length);
  });
});

describe("journey trigger validation", () => {
  it("accepts the supported triggers and bounds the inactivity window", () => {
    expect(validateJourneyTrigger({ type: "contact_subscribed_to_territory" })).toEqual({ type: "contact_subscribed_to_territory" });
    expect(validateJourneyTrigger({ type: "digital_edition_published" })).toEqual({ type: "digital_edition_published" });
    expect(validateJourneyTrigger({ type: "contact_inactive", days: 90 })).toEqual({ type: "contact_inactive", days: 90 });
    expect(() => validateJourneyTrigger({ type: "contact_inactive" })).toThrow(/days/);
    expect(() => validateJourneyTrigger({ type: "contact_inactive", days: 3 })).toThrow(/between 14 and 365/);
    expect(() => validateJourneyTrigger({ type: "contact_inactive", days: 90.5 })).toThrow(/whole number/);
    expect(() => validateJourneyTrigger({ type: "made_up" })).toThrow(/malformed/);
  });
});

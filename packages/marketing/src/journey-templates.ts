import { validateJourneyConditions, validateJourneySteps, validateJourneyTrigger } from "./journey-validation";
import type { JourneyCondition, JourneyStep, JourneyTrigger } from "./types";

/**
 * The named journeys the network runs, each defined once so a franchise starts from the same reviewed
 * copy, timing and cap. A template is only ever a starting draft: it is created through the normal
 * journey flow and still has to be approved and activated before anyone is emailed.
 *
 * Only journeys whose trigger can actually fire are defined. Local event digest, competition follow-up,
 * sponsored campaigns and school-holiday countdowns need triggers (competition entries, a holiday
 * calendar, advertiser campaign events) that do not exist yet, so they are not faked here.
 */
export type JourneyTemplate = {
  key: "welcome" | "re_engagement" | "digital_magazine";
  name: string;
  description: string;
  frequencyCap: { maxPerContact: number; window: "lifetime" | "24h" | "7d" | "30d" };
  trigger: JourneyTrigger;
  conditions: JourneyCondition[];
  steps: JourneyStep[];
};

const text = (id: string, html: string) => ({ id, type: "text" as const, html });

export const journeyTemplates: JourneyTemplate[] = [
  {
    key: "welcome",
    name: "Welcome to Raring2go",
    description: "One welcome email as soon as someone subscribes to an area.",
    frequencyCap: { maxPerContact: 1, window: "lifetime" },
    trigger: { type: "contact_subscribed_to_territory" },
    conditions: [],
    steps: [
      {
        key: "welcome-email",
        actionType: "send_email",
        delayMinutes: 0,
        transactional: true,
        email: {
          subject: "Welcome to Raring2go!",
          blocks: [text("welcome-1", "<p>Thanks for subscribing. We will share local days out, events and offers for families near you.</p><p>You can change what you hear about, or stop emails, at any time from your preferences.</p>")]
        }
      }
    ]
  },
  {
    key: "re_engagement",
    name: "We miss you",
    description: "Two gentle emails, a week apart, to subscribers who have not engaged for 90 days.",
    frequencyCap: { maxPerContact: 2, window: "30d" },
    trigger: { type: "contact_inactive", days: 90 },
    conditions: [],
    steps: [
      {
        key: "miss-you",
        actionType: "send_email",
        delayMinutes: 0,
        email: { subject: "Still enjoying Raring2go?", blocks: [text("miss-1", "<p>It has been a while. Here is what is new near you, and a reminder you can change how often we email from your preferences.</p>")] }
      },
      {
        key: "last-chance",
        actionType: "send_email",
        delayMinutes: 7 * 24 * 60,
        email: { subject: "Shall we keep in touch?", blocks: [text("miss-2", "<p>If you would rather not hear from us, no problem: use the unsubscribe link below. Otherwise we will keep sending the occasional local idea.</p>")] }
      }
    ]
  },
  {
    key: "digital_magazine",
    name: "New digital magazine",
    description: "Tells an area's subscribers when its new digital magazine is published. Sent once per edition.",
    frequencyCap: { maxPerContact: 1, window: "30d" },
    trigger: { type: "digital_edition_published" },
    conditions: [],
    steps: [
      {
        key: "magazine-email",
        actionType: "send_email",
        delayMinutes: 0,
        email: { subject: "Your new Raring2go magazine is out", blocks: [text("mag-1", "<p>The latest digital magazine for your area has just been published. Read it online from your area page.</p>")] }
      }
    ]
  }
];

export function findJourneyTemplate(key: string) {
  return journeyTemplates.find((template) => template.key === key);
}

/** Runs a template through the same validators untrusted journey JSON goes through. Used by tests so a template can never drift invalid. */
export function validateJourneyTemplate(template: JourneyTemplate) {
  return {
    trigger: validateJourneyTrigger(template.trigger),
    conditions: validateJourneyConditions(template.conditions),
    steps: validateJourneySteps(template.steps)
  };
}

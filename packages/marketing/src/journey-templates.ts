import { assertJourneyContentTokens } from "./journey-content";
import { validateJourneyConditions, validateJourneySteps, validateJourneyTrigger } from "./journey-validation";
import type { JourneyCondition, JourneyStep, JourneyTrigger } from "./types";

/**
 * The named journeys the network runs, each defined once so a franchise starts from the same reviewed
 * copy, timing and cap. A template is only ever a starting draft: it is created through the normal
 * journey flow and still has to be approved and activated before anyone is emailed.
 *
 * Only journeys whose trigger can actually fire are defined. The school-holiday countdown runs from the HQ
 * holiday calendar and the weekly local digest from approved public events. Competition follow-up and
 * sponsored campaigns need triggers (competition entries, advertiser campaign events) that do not exist
 * yet, so they are not faked here.
 */
export type JourneyTemplate = {
  key: "welcome" | "re_engagement" | "digital_magazine" | "school_holiday_countdown" | "weekly_digest" | "competition_follow_up";
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
  },
  {
    key: "school_holiday_countdown",
    name: "School holiday countdown",
    description: "One email a set number of days before each school holiday in the HQ calendar, naming the holiday and its dates. Run a second copy with fewer days for a last reminder.",
    frequencyCap: { maxPerContact: 1, window: "30d" },
    trigger: { type: "school_holiday_approaching", daysBefore: 14 },
    conditions: [],
    steps: [
      {
        key: "holiday-countdown",
        actionType: "send_email",
        delayMinutes: 0,
        email: {
          subject: "[[holiday_name]] starts in [[days_until]] days",
          blocks: [
            { id: "hol-1", type: "heading", text: "[[holiday_name]] is nearly here", level: 1 },
            text("hol-2", "<p>The school holidays start on [[holiday_starts]] and run to [[holiday_ends]]. That is about [[days_until]] days away.</p><p>See what is on and find ideas for [[area_name]] from your area page.</p>")
          ]
        }
      }
    ]
  },
  {
    key: "weekly_digest",
    name: "Weekly local events digest",
    description: "Once a week, on the chosen weekday, the next local events for subscribers of an area. Nothing is sent for an area with no events coming up.",
    frequencyCap: { maxPerContact: 1, window: "7d" },
    trigger: { type: "weekly_digest", weekday: 5 },
    conditions: [],
    steps: [
      {
        key: "weekly-digest",
        actionType: "send_email",
        delayMinutes: 0,
        email: {
          subject: "What is on near you in [[area_name]]",
          blocks: [text("dig-1", "<p>Here is what is coming up near you:</p>"), text("dig-2", "[[local_events|html]]"), text("dig-3", "<p>You can change what you hear about, or stop emails, at any time from your preferences.</p>")]
        }
      }
    ]
  },
  {
    key: "competition_follow_up",
    name: "Competition follow-up",
    description: "Once a competition has closed, thanks each entrant who subscribes to the area, says winners are contacted directly, and points to what else is on. Only people who entered and also subscribed get it; entering alone never signs anyone up.",
    frequencyCap: { maxPerContact: 1, window: "7d" },
    trigger: { type: "competition_closed" },
    conditions: [],
    steps: [
      {
        key: "competition-thanks",
        actionType: "send_email",
        delayMinutes: 0,
        email: {
          subject: "Thanks for entering [[competition_title]]",
          blocks: [
            { id: "comp-1", type: "heading", text: "[[competition_title]] has closed", level: 1 },
            text("comp-2", "<p>Thank you for entering. Winners are contacted directly by email, so keep an eye on your inbox.</p><p>There is plenty more coming up in [[area_name]]: have a look at what is on from your area page.</p>")
          ]
        }
      }
    ]
  }
];

export function findJourneyTemplate(key: string) {
  return journeyTemplates.find((template) => template.key === key);
}

/** Runs a template through the same validators untrusted journey JSON goes through. Used by tests so a template can never drift invalid. */
export function validateJourneyTemplate(template: JourneyTemplate) {
  const trigger = validateJourneyTrigger(template.trigger);
  const steps = validateJourneySteps(template.steps);
  assertJourneyContentTokens(trigger, steps);
  return { trigger, conditions: validateJourneyConditions(template.conditions), steps };
}

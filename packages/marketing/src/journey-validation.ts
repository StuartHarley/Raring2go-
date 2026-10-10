import { isRecord, validateBlocks } from "./blocks";
import { looksLikeCondition } from "./segment-rules";
import type { JourneyCondition, JourneyStep, JourneyTrigger } from "./types";

const JOURNEY_TRIGGER_TYPES = new Set(["contact_subscribed_to_territory", "contact_inactive", "digital_edition_published", "school_holiday_approaching", "weekly_digest", "competition_closed"]);
const JOURNEY_STEP_ACTION_TYPES = new Set(["send_email"]);

/**
 * The real trust boundary for a journey's trigger, arriving as untrusted
 * client JSON from the journey builder UI.
 */
export function validateJourneyTrigger(raw: unknown): JourneyTrigger {
  if (!isRecord(raw) || typeof raw.type !== "string" || !JOURNEY_TRIGGER_TYPES.has(raw.type)) {
    throw new Error("Journey trigger is malformed.");
  }
  if (raw.type === "contact_inactive") {
    const days = raw.days;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 14 || days > 365) {
      throw new Error("A re-engagement trigger needs a whole number of days between 14 and 365.");
    }
    return { type: "contact_inactive", days };
  }
  if (raw.type === "school_holiday_approaching") {
    const daysBefore = raw.daysBefore;
    if (typeof daysBefore !== "number" || !Number.isInteger(daysBefore) || daysBefore < 1 || daysBefore > 60) {
      throw new Error("A school-holiday trigger needs a whole number of days before the holiday, between 1 and 60.");
    }
    return { type: "school_holiday_approaching", daysBefore };
  }
  if (raw.type === "weekly_digest") {
    const weekday = raw.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      throw new Error("A weekly digest needs a weekday from 0 (Sunday) to 6 (Saturday).");
    }
    return { type: "weekly_digest", weekday };
  }
  return { type: raw.type } as JourneyTrigger;
}

/**
 * conditions is a flat array (no nested groups, unlike a full segment rule
 * tree) - each entry must look like a real SegmentRuleCondition.
 */
export function validateJourneyConditions(raw: unknown): JourneyCondition[] {
  if (!Array.isArray(raw)) {
    throw new Error("Journey conditions must be an array.");
  }
  return raw.map((entry, index) => {
    if (!looksLikeCondition(entry)) {
      throw new Error(`Journey condition at index ${index} is malformed.`);
    }
    return entry;
  });
}

export function validateJourneySteps(raw: unknown): JourneyStep[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("A journey needs at least one step.");
  }
  const keys = new Set<string>();
  return raw.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.key !== "string" || !entry.key.trim()) {
      throw new Error(`Journey step at index ${index} is missing a valid key.`);
    }
    if (keys.has(entry.key)) {
      throw new Error(`Journey step key "${entry.key}" is used more than once.`);
    }
    keys.add(entry.key);
    if (typeof entry.actionType !== "string" || !JOURNEY_STEP_ACTION_TYPES.has(entry.actionType)) {
      throw new Error(`Journey step "${entry.key}" has an unrecognised action type.`);
    }
    if (typeof entry.delayMinutes !== "number" || !Number.isFinite(entry.delayMinutes) || entry.delayMinutes < 0) {
      throw new Error(`Journey step "${entry.key}" requires a non-negative delayMinutes.`);
    }
    if (!isRecord(entry.email) || typeof entry.email.subject !== "string" || !entry.email.subject.trim()) {
      throw new Error(`Journey step "${entry.key}" requires an email subject.`);
    }
    return {
      key: entry.key,
      actionType: "send_email",
      delayMinutes: entry.delayMinutes,
      ...(entry.transactional === true ? { transactional: true } : {}),
      email: {
        subject: entry.email.subject,
        blocks: validateBlocks(entry.email.blocks)
      }
    };
  });
}

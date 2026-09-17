import { describe, expect, it } from "vitest";
import { validateJourneyConditions, validateJourneySteps, validateJourneyTrigger } from "./journey-validation";

describe("validateJourneyTrigger", () => {
  it("accepts the one known trigger type", () => {
    expect(validateJourneyTrigger({ type: "contact_subscribed_to_territory" })).toEqual({
      type: "contact_subscribed_to_territory"
    });
  });

  it("rejects an unrecognised trigger type", () => {
    expect(() => validateJourneyTrigger({ type: "something_else" })).toThrow("Journey trigger is malformed.");
  });

  it("rejects a malformed payload", () => {
    expect(() => validateJourneyTrigger(null)).toThrow("Journey trigger is malformed.");
    expect(() => validateJourneyTrigger("contact_subscribed_to_territory")).toThrow("Journey trigger is malformed.");
  });
});

describe("validateJourneyConditions", () => {
  it("accepts a flat array of real segment-rule conditions", () => {
    const raw = [{ kind: "condition", field: "tag", operator: "equals", value: "vip" }];
    expect(validateJourneyConditions(raw)).toEqual(raw);
  });

  it("accepts an empty array", () => {
    expect(validateJourneyConditions([])).toEqual([]);
  });

  it("rejects a non-array payload", () => {
    expect(() => validateJourneyConditions({ kind: "condition" })).toThrow("Journey conditions must be an array.");
  });

  it("rejects an entry that isn't a real condition, naming its index", () => {
    expect(() =>
      validateJourneyConditions([
        { kind: "condition", field: "tag", operator: "equals", value: "vip" },
        { kind: "group", match: "all", children: [] }
      ])
    ).toThrow("Journey condition at index 1 is malformed.");
  });

  it("rejects an unrecognised field or operator", () => {
    expect(() => validateJourneyConditions([{ kind: "condition", field: "nope", operator: "equals" }])).toThrow(
      "Journey condition at index 0 is malformed."
    );
  });
});

describe("validateJourneySteps", () => {
  function validStep(key: string) {
    return {
      key,
      actionType: "send_email",
      delayMinutes: 0,
      email: { subject: "Welcome", blocks: [{ id: "b1", type: "text", html: "<p>Hi</p>" }] }
    };
  }

  it("accepts a well-formed step list", () => {
    const steps = validateJourneySteps([validStep("a"), { ...validStep("b"), delayMinutes: 60 }]);
    expect(steps).toHaveLength(2);
    expect(steps[1]!.delayMinutes).toBe(60);
    expect(steps[0]!.email.blocks).toHaveLength(1);
  });

  it("rejects an empty step list", () => {
    expect(() => validateJourneySteps([])).toThrow("A journey needs at least one step.");
    expect(() => validateJourneySteps("nope")).toThrow("A journey needs at least one step.");
  });

  it("rejects a missing or blank step key", () => {
    expect(() => validateJourneySteps([{ ...validStep("a"), key: "" }])).toThrow("missing a valid key");
  });

  it("rejects a duplicate step key", () => {
    expect(() => validateJourneySteps([validStep("a"), validStep("a")])).toThrow('Journey step key "a" is used more than once.');
  });

  it("rejects an unrecognised action type", () => {
    expect(() => validateJourneySteps([{ ...validStep("a"), actionType: "add_to_crm" }])).toThrow("unrecognised action type");
  });

  it("rejects a negative or non-numeric delay", () => {
    expect(() => validateJourneySteps([{ ...validStep("a"), delayMinutes: -1 }])).toThrow("non-negative delayMinutes");
    expect(() => validateJourneySteps([{ ...validStep("a"), delayMinutes: "soon" }])).toThrow("non-negative delayMinutes");
  });

  it("rejects a missing email subject", () => {
    expect(() => validateJourneySteps([{ ...validStep("a"), email: { subject: "", blocks: [] } }])).toThrow("requires an email subject");
  });

  it("re-validates the step's email blocks through validateBlocks, rejecting an unsafe block", () => {
    expect(() =>
      validateJourneySteps([{ ...validStep("a"), email: { subject: "Hi", blocks: [{ id: "b1", type: "button", label: "Go", href: "javascript:alert(1)" }] } }])
    ).toThrow();
  });
});

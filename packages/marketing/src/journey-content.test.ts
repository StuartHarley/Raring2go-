import { describe, expect, it } from "vitest";
import { JourneyContentUnavailableError, assertJourneyContentTokens, fillJourneyContent, stepUsesContentTokens } from "./journey-content";
import { journeyTemplates, validateJourneyTemplate } from "./journey-templates";
import { validateJourneyTrigger } from "./journey-validation";
import type { JourneyStep, JourneyTrigger } from "./types";

const holiday: JourneyTrigger = { type: "school_holiday_approaching", daysBefore: 14 };
const digest: JourneyTrigger = { type: "weekly_digest", weekday: 5 };
const step = (subject: string, ...html: string[]): JourneyStep => ({ key: "s", actionType: "send_email", delayMinutes: 0, email: { subject, blocks: html.map((value, index) => ({ id: `b${index}`, type: "text" as const, html: value })) } });

describe("journey content tokens", () => {
  it("every shipped template validates, tokens included", () => {
    for (const template of journeyTemplates) expect(() => validateJourneyTemplate(template)).not.toThrow();
    expect(journeyTemplates.map((t) => t.key)).toEqual(expect.arrayContaining(["school_holiday_countdown", "weekly_digest"]));
  });
  it("allows only the tokens a trigger provides", () => {
    expect(() => assertJourneyContentTokens(holiday, [step("[[holiday_name]] soon", "<p>[[days_until]]</p>")])).not.toThrow();
    expect(() => assertJourneyContentTokens(holiday, [step("hi", "<p>[[local_events|html]]</p>")])).toThrow(/not available/);
    expect(() => assertJourneyContentTokens(digest, [step("hi", "<p>[[holiday_name]]</p>")])).toThrow(/not available/);
    expect(() => assertJourneyContentTokens({ type: "contact_subscribed_to_territory" }, [step("[[area_name]]", "<p>x</p>")])).toThrow(/not available/);
    expect(() => assertJourneyContentTokens(digest, [step("hi", "<p>[[local_events]]</p>")])).toThrow(/must be written/);
    expect(() => assertJourneyContentTokens(digest, [step("[[local_events|html]]", "<p>x</p>")])).toThrow(/only be used in a text block/);
    expect(() => assertJourneyContentTokens(holiday, [step("hi", "<p>[[holiday_name|html]]</p>")])).toThrow(/not an html field/);
    const button: JourneyStep = { key: "b", actionType: "send_email", delayMinutes: 0, email: { subject: "x", blocks: [{ id: "1", type: "button", label: "[[holiday_name]]", href: "https://x.test" }] } };
    expect(() => assertJourneyContentTokens(holiday, [button])).toThrow(/subject, headings and text blocks/);
  });
  it("fills plain values escaped, html values sanitised, and refuses a missing value", () => {
    const content = { variantKey: "v", fields: { holiday_name: { value: "<b>Half</b> & term" }, area_name: { value: "Sutton" }, local_events: { value: '<ul><li><a href="https://x.test/e">One</a><script>alert(1)</script></li></ul>', html: true } } };
    const filled = fillJourneyContent({ subject: "[[holiday_name]] in [[area_name]]", blocks: [{ id: "1", type: "heading", text: "[[holiday_name]]", level: 1 }, { id: "2", type: "text", html: "<p>[[holiday_name]]</p>[[local_events|html]]" }] }, content);
    expect(filled.subject).toBe("<b>Half</b> & term in Sutton");
    expect((filled.blocks[0] as { text: string }).text).toBe("<b>Half</b> & term");
    const html = (filled.blocks[1] as { html: string }).html;
    expect(html).toContain("&lt;b&gt;Half&lt;/b&gt; &amp; term");
    expect(html).toContain('<a href="https://x.test/e"');
    expect(html).not.toContain("<script");
    expect(() => fillJourneyContent({ subject: "[[days_until]]", blocks: [] }, content)).toThrow(JourneyContentUnavailableError);
    expect(() => fillJourneyContent({ subject: "[[area_name]]", blocks: [] }, undefined)).toThrow(JourneyContentUnavailableError);
    expect(() => fillJourneyContent({ subject: "[[area_name]]", blocks: [] }, { variantKey: "v", fields: { area_name: { value: "" } } })).toThrow(JourneyContentUnavailableError);
    expect(fillJourneyContent({ subject: "no tokens", blocks: [] }, undefined).subject).toBe("no tokens");
    expect(stepUsesContentTokens(step("[[area_name]]", "<p>x</p>"))).toBe(true);
    expect(stepUsesContentTokens(step("plain", "<p>{{firstName}}</p>"))).toBe(false);
  });
  it("validates the new triggers' parameters", () => {
    expect(validateJourneyTrigger({ type: "school_holiday_approaching", daysBefore: 7 })).toEqual({ type: "school_holiday_approaching", daysBefore: 7 });
    for (const bad of [0, 61, 2.5, "7", undefined]) expect(() => validateJourneyTrigger({ type: "school_holiday_approaching", daysBefore: bad })).toThrow(/days before/);
    expect(validateJourneyTrigger({ type: "weekly_digest", weekday: 0 })).toEqual({ type: "weekly_digest", weekday: 0 });
    for (const bad of [-1, 7, 1.5, "5", undefined]) expect(() => validateJourneyTrigger({ type: "weekly_digest", weekday: bad })).toThrow(/weekday/);
  });
});

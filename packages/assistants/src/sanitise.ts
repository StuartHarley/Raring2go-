import { AiOutputError } from "@raring2go/ai";

/**
 * Everything a model returns is untrusted text. These helpers turn it into bounded plain text, or
 * refuse it: no markup ever reaches a stored output, lists are capped, and every value a model gives
 * back is checked against the facts it was given before it is kept.
 */

/** Plain text: HTML tags stripped, whitespace tidied, length bounded. */
export function plainText(value: unknown, max: number, field: string, options: { required?: boolean } = {}): string {
  if (value === undefined || value === null || value === "") {
    if (options.required) throw new AiOutputError(`The AI result is missing its ${field}.`);
    return "";
  }
  if (typeof value !== "string") throw new AiOutputError(`The AI result's ${field} was not text.`);
  const text = value.replace(/<[^>]*>/g, "").replace(/[ \t]+\n/g, "\n").trim();
  if (options.required && !text) throw new AiOutputError(`The AI result is missing its ${field}.`);
  return text.length > max ? text.slice(0, max).trimEnd() : text;
}

export function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiOutputError(`The AI did not return ${what} in the expected shape.`);
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : [];
}

/** Parse a model reply that should be a JSON object, tolerating code fences. */
export function parseJsonObject(text: string, what: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AiOutputError(`The AI did not return usable ${what}. Try again.`);
  }
  return asRecord(parsed, what);
}

export const moneyFromMinor = (minor: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(minor / 100);

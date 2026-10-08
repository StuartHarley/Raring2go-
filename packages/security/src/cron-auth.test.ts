import { describe, expect, it } from "vitest";
import { isAuthorizedCronRequest } from "./cron-auth";

const headers = (authorization?: string) => ({ get: (name: string) => (name.toLowerCase() === "authorization" ? (authorization ?? null) : null) });

describe("cron authorisation", () => {
  it("accepts only the exact bearer secret when one is configured", () => {
    const env = { CRON_SECRET: "s3cret-value-that-is-long-enough", NODE_ENV: "production" };
    expect(isAuthorizedCronRequest(headers("Bearer s3cret-value-that-is-long-enough"), env)).toBe(true);
    expect(isAuthorizedCronRequest(headers("Bearer s3cret-value-that-is-long-enough-x"), env)).toBe(false);
    expect(isAuthorizedCronRequest(headers("Bearer wrong"), env)).toBe(false);
    expect(isAuthorizedCronRequest(headers("s3cret-value-that-is-long-enough"), env)).toBe(false);
    expect(isAuthorizedCronRequest(headers(), env)).toBe(false);
  });

  it("is open without a secret only in local development and tests", () => {
    expect(isAuthorizedCronRequest(headers(), { NODE_ENV: "development" })).toBe(true);
    expect(isAuthorizedCronRequest(headers(), { NODE_ENV: "test" })).toBe(true);
  });

  it("fails closed in a deployed build with no secret, whatever APP_ENV says", () => {
    expect(isAuthorizedCronRequest(headers(), { NODE_ENV: "production" })).toBe(false);
    expect(isAuthorizedCronRequest(headers(), { NODE_ENV: "production", APP_ENV: "preview" })).toBe(false);
    // The old check treated an unset APP_ENV as "not production" and left the endpoint open.
    expect(isAuthorizedCronRequest(headers(), { NODE_ENV: "production", APP_ENV: undefined })).toBe(false);
    expect(isAuthorizedCronRequest(headers(), {})).toBe(false);
  });
});

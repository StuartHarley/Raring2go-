import { describe, expect, it } from "vitest";
import { createEnv } from "./env";

describe("createEnv", () => {
  it("returns defaults for optional foundation settings", () => {
    expect(createEnv({})).toEqual({
      APP_ENV: "development",
      NEXT_PUBLIC_APP_NAME: "Raring2go Business-in-a-Box"
    });
  });

  it("fails when an environment value is invalid", () => {
    expect(() =>
      createEnv({
        APP_ENV: "staging"
      })
    ).toThrow("Invalid environment");
  });

  it("validates deployment URLs when they are configured", () => {
    expect(createEnv({
      APP_URL: "https://app.raring2go.co.uk",
      NEXT_PUBLIC_SITE_URL: "https://mis.raring2go.co.uk"
    })).toMatchObject({
      APP_URL: "https://app.raring2go.co.uk",
      NEXT_PUBLIC_SITE_URL: "https://mis.raring2go.co.uk"
    });

    expect(() => createEnv({
      NEXT_PUBLIC_SITE_URL: "mis.raring2go.co.uk"
    })).toThrow("Invalid environment");
  });
});

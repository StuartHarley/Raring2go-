import { describe, expect, it } from "vitest";
import { assertSeedAllowed } from "./seed";

describe("seed policy", () => {
  it("allows local and preview seed execution", () => {
    expect(() => assertSeedAllowed({ APP_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertSeedAllowed({ APP_ENV: "preview" } as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("blocks production seeds unless explicitly approved", () => {
    expect(() => assertSeedAllowed({ APP_ENV: "production" } as NodeJS.ProcessEnv)).toThrow("Production seed is disabled");
    expect(() => assertSeedAllowed({
      APP_ENV: "production",
      ALLOW_PRODUCTION_SEED: "true"
    } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

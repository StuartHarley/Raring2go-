import { afterEach, describe, expect, it, vi } from "vitest";
import { eSignProvider } from "./franchise-runtime";

describe("e-signature provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the development provider locally", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(eSignProvider().key).toBe("development");
  });

  it("fails closed in production instead of pretending documents were sent", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => eSignProvider()).toThrow(/not available in production/);
  });
});

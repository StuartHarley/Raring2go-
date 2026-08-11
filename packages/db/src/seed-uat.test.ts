import { describe, expect, it } from "vitest";
import { seedUatDatabase } from "./seed-uat";

describe("UAT seed policy", () => {
  it("requires an explicit UAT admin email", async () => {
    await expect(seedUatDatabase("postgres://unused", {} as NodeJS.ProcessEnv))
      .rejects
      .toThrow("UAT_ADMIN_EMAIL");
  });
});

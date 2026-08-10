import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";
import { findOrCreateUserByEmail } from "./identity";
import { createMemoryAuthRepository } from "./test-helpers";

describe("identity email handling", () => {
  it("normalises email for the global user identity", async () => {
    const repository = createMemoryAuthRepository({
      users: [
        {
          id: "user_1",
          email: "stuart@example.com",
          displayName: "Stuart",
          status: "active"
        }
      ]
    });

    expect(normalizeEmail("  STUART@Example.COM ")).toBe("stuart@example.com");

    const user = await findOrCreateUserByEmail(repository, {
      email: "  STUART@Example.COM "
    });

    expect(user.id).toBe("user_1");
    expect(repository.users).toHaveLength(1);
  });
});

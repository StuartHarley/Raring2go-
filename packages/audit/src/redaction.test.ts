import { describe, expect, it } from "vitest";
import { redactSensitiveData, redactedValue } from "./redaction";

describe("redactSensitiveData", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redactSensitiveData({
        email: "person@example.com",
        password: "never-store",
        nested: {
          apiKey: "secret-key",
          token: "secret-token"
        },
        cards: [{ cardNumber: "4111111111111111", last4: "1111" }]
      })
    ).toEqual({
      email: "person@example.com",
      password: redactedValue,
      nested: {
        apiKey: redactedValue,
        token: redactedValue
      },
      cards: [{ cardNumber: redactedValue, last4: "1111" }]
    });
  });
});

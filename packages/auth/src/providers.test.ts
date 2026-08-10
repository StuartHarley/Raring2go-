import { describe, expect, it } from "vitest";
import { createAuthJsBoundary } from "./providers";

describe("provider boundary", () => {
  it("keeps Auth.js config behind the Raring2go provider abstraction", () => {
    const boundary = createAuthJsBoundary({
      providers: [
        {
          id: "email",
          kind: "email",
          displayName: "Email"
        }
      ],
      authJsProviders: []
    });

    expect(boundary.providers).toEqual([
      {
        id: "email",
        kind: "email",
        displayName: "Email"
      }
    ]);
    expect(boundary.createAuthJsConfig()).toEqual({
      providers: []
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  createMetaAuthorizationUrl,
  exchangeMetaOAuthCode,
  listMetaFacebookPages
} from "./meta-oauth";

const config = {
  appId: "app_1",
  appSecret: "app_secret",
  redirectUri: "https://app.test/api/integrations/meta/callback",
  scopes: ["pages_manage_posts", "pages_read_engagement"]
};

describe("Meta OAuth helpers", () => {
  it("creates a state-bound OAuth URL", () => {
    const url = createMetaAuthorizationUrl({ config, state: "state_1" });

    expect(url.searchParams.get("client_id")).toBe("app_1");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("scope")).toContain("pages_manage_posts");
  });

  it("exchanges codes without returning raw provider metadata as domain data", async () => {
    const result = await exchangeMetaOAuthCode({
      config,
      code: "code_1",
      fetch: async () => new Response(JSON.stringify({
        access_token: "user-token",
        expires_in: 3600
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });

    expect(result.accessToken).toBe("user-token");
    expect(JSON.stringify(result.safeMetadata)).not.toContain("user-token");
  });

  it("returns explicit eligible Pages without picking the first one", async () => {
    const pages = await listMetaFacebookPages({
      userAccessToken: "user-token",
      fetch: async () => new Response(JSON.stringify({
        data: [
          { id: "page_1", name: "One", access_token: "page-token-1", tasks: ["CREATE_CONTENT"] },
          { id: "page_2", name: "Two", access_token: "page-token-2", tasks: ["CREATE_CONTENT"] }
        ]
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });

    expect(pages.map((page) => page.name)).toEqual(["One", "Two"]);
    expect(JSON.stringify(pages.map((page) => page.safeMetadata))).not.toContain("page-token");
  });
});

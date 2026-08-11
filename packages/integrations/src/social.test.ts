import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMetaFacebookPagePublishingProvider,
  createSocialPublishingProviderFromEnv,
  sanitizeProviderMetadata
} from "./social";

const publication = {
  id: "social_pub_1",
  channel: "facebook",
  immutableSnapshot: {
    message: "Family days out this weekend",
    linkUrl: "https://raring2go.test/areas/sutton-coldfield"
  },
  timezone: "Europe/London"
};

const account = {
  id: "account_1",
  channel: "facebook",
  externalAccountReference: "page_1",
  displayName: "Raring2go Sutton Coldfield",
  capabilityMetadata: {}
};

describe("Meta Facebook Page social provider", () => {
  it("fails safely when credentials are missing", async () => {
    const provider = createMetaFacebookPagePublishingProvider({});

    await expect(provider.health?.()).resolves.toMatchObject({
      status: "missing_credentials"
    });
    await expect(provider.publish({ publication, account })).resolves.toMatchObject({
      status: "failed",
      metadata: {
        reason: "missing_credentials",
        recoverable: true
      }
    });
  });

  it("publishes to the Meta Graph API without leaking access tokens", async () => {
    const calls: string[] = [];
    const provider = createMetaFacebookPagePublishingProvider({
      pageId: "page_1",
      pageAccessToken: "page-token",
      fetch: async (input, init) => {
        calls.push(String(input));
        expect(JSON.parse(String(init?.body))).toMatchObject({
          message: "Family days out this weekend",
          link: "https://raring2go.test/areas/sutton-coldfield"
        });

        return new Response(JSON.stringify({
          id: "page_1_post_1",
          access_token: "should-not-persist"
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    const result = await provider.publish({ publication, account });

    expect(result).toMatchObject({
      status: "published",
      externalReference: "page_1_post_1"
    });
    expect(calls[0]).toContain("access_token=page-token");
    expect(JSON.stringify(result.metadata)).not.toContain("should-not-persist");
  });

  it("surfaces authentication and provider failures as recoverable state", async () => {
    const provider = createMetaFacebookPagePublishingProvider({
      pageId: "page_1",
      pageAccessToken: "expired-token",
      fetch: async () => new Response(JSON.stringify({
        error: {
          message: "Invalid OAuth access token.",
          token: "expired-token"
        }
      }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    });

    const result = await provider.publish({ publication, account });

    expect(result).toMatchObject({
      status: "failed",
      metadata: {
        reason: "authentication_failed",
        recoverable: false
      }
    });
    expect(JSON.stringify(result.metadata)).not.toContain("expired-token");
  });

  it("verifies Meta webhook signatures and maps provider events", async () => {
    const provider = createMetaFacebookPagePublishingProvider({
      pageId: "page_1",
      pageAccessToken: "page-token"
    });
    const body = JSON.stringify({
      entry: [{
        id: "page_1",
        time: 1786435200,
        changes: [{
          field: "feed",
          value: {
            post_id: "page_1_post_1",
            access_token: "never-store"
          }
        }]
      }]
    });
    const signature = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;

    const events = await provider.verifyWebhook?.({
      headers: { "x-hub-signature-256": signature },
      body,
      appSecret: "app-secret"
    });

    expect(events).toHaveLength(1);
    expect(events?.[0]).toMatchObject({
      providerKey: "meta.facebook_page",
      providerEventId: "page_1:1786435200:feed:0",
      externalReference: "page_1_post_1"
    });
    expect(JSON.stringify(events?.[0]?.payload)).not.toContain("never-store");
  });

  it("selects providers from environment and sanitises nested metadata", () => {
    expect(createSocialPublishingProviderFromEnv({
      SOCIAL_PROVIDER: "meta-facebook-page",
      META_FACEBOOK_PAGE_ID: "page_1",
      META_FACEBOOK_PAGE_ACCESS_TOKEN: "page-token"
    } as NodeJS.ProcessEnv).key).toBe("meta.facebook_page");
    expect(sanitizeProviderMetadata({
      ok: true,
      nested: {
        access_token: "secret",
        id: "post_1"
      }
    })).toEqual({
      ok: true,
      nested: {
        id: "post_1"
      }
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  createMicrosoftAuthorizationUrl,
  exchangeMicrosoftOAuthCode,
  getMicrosoftMailboxIdentity,
  refreshMicrosoftAccessToken
} from "./microsoft-oauth";

const config = {
  clientId: "client_1",
  clientSecret: "client_secret",
  tenantId: "tenant_1",
  redirectUri: "https://app.test/api/integrations/microsoft/callback",
  scopes: ["Mail.Send", "offline_access", "User.Read"]
};

describe("Microsoft OAuth helpers", () => {
  it("creates a tenant and state-bound OAuth URL", () => {
    const url = createMicrosoftAuthorizationUrl({ config, state: "state_1" });

    expect(url.toString().startsWith("https://login.microsoftonline.com/tenant_1/oauth2/v2.0/authorize")).toBe(true);
    expect(url.searchParams.get("client_id")).toBe("client_1");
    expect(url.searchParams.get("state")).toBe("state_1");
    expect(url.searchParams.get("scope")).toContain("Mail.Send");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("exchanges an authorization code for a refreshable token without leaking secrets into safe metadata", async () => {
    const requests: Array<{ url: string; body: URLSearchParams }> = [];
    const result = await exchangeMicrosoftOAuthCode({
      config,
      code: "auth_code_1",
      fetch: async (url, init) => {
        requests.push({ url: String(url), body: new URLSearchParams(String(init?.body ?? "")) });
        return new Response(JSON.stringify({
          access_token: "access-token-1",
          refresh_token: "refresh-token-1",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "Mail.Send offline_access User.Read"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(requests[0]?.url).toBe("https://login.microsoftonline.com/tenant_1/oauth2/v2.0/token");
    expect(requests[0]?.body.get("grant_type")).toBe("authorization_code");
    expect(requests[0]?.body.get("code")).toBe("auth_code_1");
    expect(requests[0]?.body.get("client_secret")).toBe("client_secret");
    expect(result.accessToken).toBe("access-token-1");
    expect(result.refreshToken).toBe("refresh-token-1");
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(JSON.stringify(result.safeMetadata)).not.toContain("access-token-1");
    expect(JSON.stringify(result.safeMetadata)).not.toContain("refresh-token-1");
    expect(JSON.stringify(result.safeMetadata)).not.toContain("client_secret");
  });

  it("refreshes an access token and keeps the prior refresh token when Microsoft omits a new one", async () => {
    const result = await refreshMicrosoftAccessToken({
      config,
      refreshToken: "refresh-token-old",
      fetch: async (_url, init) => {
        const body = new URLSearchParams(String(init?.body ?? ""));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("refresh-token-old");
        return new Response(JSON.stringify({
          access_token: "access-token-2",
          expires_in: 3600
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(result.accessToken).toBe("access-token-2");
    expect(result.refreshToken).toBe("refresh-token-old");
  });

  it("throws a readable error when the token endpoint rejects the request", async () => {
    await expect(
      exchangeMicrosoftOAuthCode({
        config,
        code: "bad_code",
        fetch: async () => new Response(JSON.stringify({
          error: "invalid_grant",
          error_description: "The provided authorization code is invalid."
        }), { status: 400, headers: { "content-type": "application/json" } })
      })
    ).rejects.toThrow("The provided authorization code is invalid.");
  });

  it("fetches the connected mailbox identity from Microsoft Graph", async () => {
    const identity = await getMicrosoftMailboxIdentity({
      accessToken: "access-token-1",
      fetch: async (url, init) => {
        expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer access-token-1");
        return new Response(JSON.stringify({
          id: "mailbox_1",
          displayName: "Sutton Coldfield Team",
          mail: "sutton@raring2go.co.uk",
          userPrincipalName: "sutton@raring2go.onmicrosoft.com"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(identity).toEqual({
      id: "mailbox_1",
      displayName: "Sutton Coldfield Team",
      mail: "sutton@raring2go.co.uk",
      userPrincipalName: "sutton@raring2go.onmicrosoft.com"
    });
  });

  it("throws when Microsoft Graph rejects the identity request", async () => {
    await expect(
      getMicrosoftMailboxIdentity({
        accessToken: "expired-token",
        fetch: async () => new Response(JSON.stringify({
          error: { code: "InvalidAuthenticationToken", message: "Access token has expired." }
        }), { status: 401, headers: { "content-type": "application/json" } })
      })
    ).rejects.toThrow("Access token has expired.");
  });
});

import { createHash } from "node:crypto";
import { sanitizeProviderMetadata } from "./social";

export type MetaOAuthConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphApiVersion?: string;
  scopes: string[];
};

export type MetaPageCandidate = {
  id: string;
  name: string;
  accessToken: string;
  grantedScopes: string[];
  expiresAt?: Date | null;
  safeMetadata: Record<string, unknown>;
};

export function createMetaAuthorizationUrl(input: {
  config: MetaOAuthConfig;
  state: string;
  codeChallenge?: string;
}) {
  const url = new URL("https://www.facebook.com/dialog/oauth");
  url.searchParams.set("client_id", input.config.appId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.config.scopes.join(","));
  url.searchParams.set("response_type", "code");
  if (input.codeChallenge) {
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url;
}

export async function exchangeMetaOAuthCode(input: {
  config: MetaOAuthConfig;
  code: string;
  fetch?: typeof fetch;
}) {
  const fetcher = input.fetch ?? fetch;
  const graphApiVersion = input.config.graphApiVersion ?? "v20.0";
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", input.config.appId);
  url.searchParams.set("client_secret", input.config.appSecret);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("code", input.code);

  const response = await fetcher(url);
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    expires_in?: number;
    error?: Record<string, unknown>;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(providerErrorSummary(payload.error, "Meta OAuth token exchange failed."));
  }
  return {
    accessToken: payload.access_token,
    expiresAt: payload.expires_in
      ? new Date(Date.now() + payload.expires_in * 1000)
      : null,
    safeMetadata: sanitizeProviderMetadata(payload as Record<string, unknown>)
  };
}

export async function listMetaFacebookPages(input: {
  userAccessToken: string;
  graphApiVersion?: string;
  fetch?: typeof fetch;
}): Promise<MetaPageCandidate[]> {
  const fetcher = input.fetch ?? fetch;
  const graphApiVersion = input.graphApiVersion ?? "v20.0";
  const url = new URL(`https://graph.facebook.com/${graphApiVersion}/me/accounts`);
  url.searchParams.set("access_token", input.userAccessToken);
  url.searchParams.set("fields", "id,name,access_token,tasks,perms");

  const response = await fetcher(url);
  const payload = await response.json().catch(() => ({})) as {
    data?: Array<{
      id?: string;
      name?: string;
      access_token?: string;
      tasks?: string[];
      perms?: string[];
    }>;
    error?: Record<string, unknown>;
  };
  if (!response.ok) {
    throw new Error(providerErrorSummary(payload.error, "Meta Page discovery failed."));
  }

  return (payload.data ?? [])
    .filter((page) => page.id && page.name && page.access_token)
    .map((page) => ({
      id: page.id!,
      name: page.name!,
      accessToken: page.access_token!,
      grantedScopes: [...new Set([...(page.tasks ?? []), ...(page.perms ?? [])])],
      expiresAt: null,
      safeMetadata: sanitizeProviderMetadata({
        tasks: page.tasks ?? [],
        perms: page.perms ?? []
      })
    }));
}

export function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function providerErrorSummary(error: Record<string, unknown> | undefined, fallback: string) {
  if (!error) return fallback;
  const message = typeof error.message === "string" ? error.message : fallback;
  const type = typeof error.type === "string" ? error.type : "provider_error";
  return `${type}: ${message}`;
}

export type MicrosoftOAuthConfig = {
  clientId: string;
  clientSecret: string;
  tenantId: string;
  redirectUri: string;
  scopes: string[];
};

export type MicrosoftTokenResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  safeMetadata: Record<string, unknown>;
};

export type MicrosoftMailboxIdentity = {
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string | null;
};

export function createMicrosoftAuthorizationUrl(input: {
  config: MicrosoftOAuthConfig;
  state: string;
}) {
  const url = new URL(`https://login.microsoftonline.com/${input.config.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", input.config.scopes.join(" "));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "query");
  return url;
}

export async function exchangeMicrosoftOAuthCode(input: {
  config: MicrosoftOAuthConfig;
  code: string;
  fetch?: typeof fetch;
}): Promise<MicrosoftTokenResult> {
  return requestMicrosoftToken({
    config: input.config,
    fetch: input.fetch,
    params: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.config.redirectUri
    }
  });
}

export async function refreshMicrosoftAccessToken(input: {
  config: MicrosoftOAuthConfig;
  refreshToken: string;
  fetch?: typeof fetch;
}): Promise<MicrosoftTokenResult> {
  const result = await requestMicrosoftToken({
    config: input.config,
    fetch: input.fetch,
    params: {
      grant_type: "refresh_token",
      refresh_token: input.refreshToken
    }
  });

  return { ...result, refreshToken: result.refreshToken ?? input.refreshToken };
}

async function requestMicrosoftToken(input: {
  config: MicrosoftOAuthConfig;
  params: Record<string, string>;
  fetch?: typeof fetch;
}): Promise<MicrosoftTokenResult> {
  const fetcher = input.fetch ?? fetch;
  const url = `https://login.microsoftonline.com/${input.config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: input.config.clientId,
    client_secret: input.config.clientSecret,
    scope: input.config.scopes.join(" "),
    ...input.params
  });

  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({})) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !payload.access_token) {
    throw new Error(microsoftErrorSummary(payload));
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token ?? null,
    expiresAt: payload.expires_in ? new Date(Date.now() + payload.expires_in * 1000) : null,
    safeMetadata: {
      tokenType: payload.token_type ?? null,
      scope: payload.scope ?? null
    }
  };
}

export async function getMicrosoftMailboxIdentity(input: {
  accessToken: string;
  fetch?: typeof fetch;
}): Promise<MicrosoftMailboxIdentity> {
  const fetcher = input.fetch ?? fetch;
  const response = await fetcher("https://graph.microsoft.com/v1.0/me", {
    headers: { authorization: `Bearer ${input.accessToken}` }
  });
  const payload = await response.json().catch(() => ({})) as {
    id?: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
    error?: { message?: string; code?: string };
  };

  if (!response.ok || !payload.id) {
    throw new Error(payload.error?.message ?? "Microsoft Graph request failed.");
  }

  return {
    id: payload.id,
    displayName: payload.displayName ?? payload.mail ?? payload.userPrincipalName ?? "Outlook mailbox",
    mail: payload.mail ?? null,
    userPrincipalName: payload.userPrincipalName ?? null
  };
}

function microsoftErrorSummary(payload: {
  error?: unknown;
  error_description?: unknown;
  message?: unknown;
}) {
  if (typeof payload.error_description === "string") return payload.error_description;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.error === "string") return payload.error;
  return "Microsoft OAuth request failed.";
}

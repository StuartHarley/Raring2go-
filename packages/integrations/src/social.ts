import { createHmac, timingSafeEqual } from "node:crypto";
import type { ProviderConnectionRepository } from "./connections";
import { getConnectionCredential } from "./connections";
import type { SecretStore } from "./secrets";

export type SocialProviderStatus =
  | "healthy"
  | "missing_credentials"
  | "authentication_failed"
  | "provider_error"
  | "unsupported_channel";

export type SocialPublishingProvider = {
  key: string;
  health?(): Promise<{
    status: SocialProviderStatus;
    message: string;
    metadata?: Record<string, unknown>;
  }>;
  publish(input: {
    publication: {
      id: string;
      channel: string;
      immutableSnapshot: Record<string, unknown>;
      scheduledAt?: string | null;
      timezone: string;
    };
    account: {
      id: string;
      channel: string;
      providerConnectionId?: string | null;
      externalAccountReference: string;
      displayName: string;
      capabilityMetadata: Record<string, unknown>;
    };
  }): Promise<SocialPublishResult>;
  fetchStatus?(externalReference: string): Promise<Record<string, unknown>>;
  cancel?(externalReference: string): Promise<Record<string, unknown>>;
  verifyWebhook?(input: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
    appSecret?: string;
  }): Promise<SocialProviderEvent[]>;
};

export type SocialPublishResult = {
    status: "published" | "failed";
    externalReference?: string | null;
    metadata?: Record<string, unknown>;
};

export type SocialProviderEvent = {
  providerKey: string;
  providerEventId: string;
  eventType: string;
  externalReference?: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
};

export function createDevelopmentSocialPublishingProvider(): SocialPublishingProvider {
  return {
    key: "development",
    async health() {
      return {
        status: "healthy",
        message: "Development social provider is deterministic and does not publish externally."
      };
    },
    async publish({ publication }) {
      return {
        status: "published",
        externalReference: `dev-${publication.id}`,
        metadata: { deterministic: true }
      };
    }
  };
}

export function createMetaFacebookPagePublishingProvider(input: {
  pageId?: string;
  pageAccessToken?: string;
  resolvePageAccessToken?: (input: {
    account: {
      id: string;
      externalAccountReference: string;
      providerConnectionId?: string | null;
    };
  }) => Promise<{ pageId: string; pageAccessToken: string }>;
  graphApiVersion?: string;
  fetch?: typeof fetch;
}): SocialPublishingProvider {
  const providerKey = "meta.facebook_page";
  const graphApiVersion = input.graphApiVersion ?? "v20.0";

  return {
    key: providerKey,
    async health() {
      if (!input.pageId && !input.resolvePageAccessToken) {
        return {
          status: "missing_credentials",
          message: "Meta Facebook Page publishing requires a scoped provider connection or development Page credentials.",
          metadata: { channel: "facebook_page" }
        };
      }

      return {
        status: "healthy",
        message: "Meta Facebook Page adapter is configured.",
        metadata: { channel: "facebook_page", graphApiVersion }
      };
    },
    async publish({ publication, account }) {
      if (publication.channel !== "facebook") {
        return {
          status: "failed",
          metadata: {
            reason: "unsupported_channel",
            channel: publication.channel
          }
        };
      }

      let credentials: { pageId: string; pageAccessToken: string } | undefined;
      try {
        credentials = await resolveCredentials(input, account);
      } catch (error) {
        return {
          status: "failed",
          metadata: {
            reason: "connection_unusable",
            recoverable: true,
            message: error instanceof Error ? error.message : "Credential resolution failed."
          }
        };
      }

      if (!credentials) {
        return {
          status: "failed",
          metadata: {
            reason: "missing_credentials",
            recoverable: true
          }
        };
      }

      const externalAccountReference = account.externalAccountReference || credentials.pageId;
      if (externalAccountReference !== credentials.pageId) {
        return {
          status: "failed",
          metadata: {
            reason: "account_mismatch",
            recoverable: false
          }
        };
      }

      const fetcher = input.fetch ?? fetch;
      const body = facebookPostPayload(publication);
      const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${credentials.pageId}/feed`);
      url.searchParams.set("access_token", credentials.pageAccessToken);

      try {
        const response = await fetcher(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-raring2go-idempotency-key": publication.id
          },
          body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({}));
        const sanitized = sanitizeProviderMetadata(payload);

        if (!response.ok) {
          return {
            status: "failed",
            metadata: {
              reason: response.status === 401 || response.status === 403
                ? "authentication_failed"
                : "provider_error",
              httpStatus: response.status,
              provider: sanitized,
              recoverable: response.status >= 500 || response.status === 429
            }
          };
        }

        const externalReference = providerPostId(payload);
        return {
          status: externalReference ? "published" : "failed",
          externalReference,
          metadata: {
            providerKey,
            httpStatus: response.status,
            provider: sanitized,
            idempotencyKey: publication.id
          }
        };
      } catch (error) {
        return {
          status: "failed",
          metadata: {
            reason: "provider_outage",
            recoverable: true,
            message: error instanceof Error ? error.message : "Unknown provider failure"
          }
        };
      }
    },
    async fetchStatus(externalReference) {
      if (!input.pageAccessToken) {
        return {
          status: "missing_credentials"
        };
      }

      const fetcher = input.fetch ?? fetch;
      const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(externalReference)}`);
      url.searchParams.set("access_token", input.pageAccessToken);
      const response = await fetcher(url);
      const payload = await response.json().catch(() => ({}));
      return sanitizeProviderMetadata({ httpStatus: response.status, ...payload });
    },
    async cancel(externalReference) {
      if (!input.pageAccessToken) {
        return {
          status: "missing_credentials"
        };
      }

      const fetcher = input.fetch ?? fetch;
      const url = new URL(`https://graph.facebook.com/${graphApiVersion}/${encodeURIComponent(externalReference)}`);
      url.searchParams.set("access_token", input.pageAccessToken);
      const response = await fetcher(url, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      return sanitizeProviderMetadata({ httpStatus: response.status, ...payload });
    },
    async verifyWebhook({ headers, body, appSecret }) {
      if (appSecret) {
        verifyMetaSignature(body, appSecret, headerValue(headers["x-hub-signature-256"]));
      }

      const payload = JSON.parse(body) as {
        entry?: Array<{
          id?: string;
          time?: number;
          changes?: Array<{ field?: string; value?: Record<string, unknown> }>;
        }>;
      };

      return (payload.entry ?? []).flatMap((entry) =>
        (entry.changes ?? []).map((change, index) => ({
          providerKey,
          providerEventId: `${entry.id ?? "unknown"}:${entry.time ?? "unknown"}:${change.field ?? "unknown"}:${index}`,
          eventType: change.field ?? "unknown",
          externalReference: typeof change.value?.post_id === "string" ? change.value.post_id : null,
          occurredAt: entry.time ? new Date(entry.time * 1000).toISOString() : new Date().toISOString(),
          payload: sanitizeProviderMetadata(change.value ?? {})
        }))
      );
    }
  };
}

async function resolveCredentials(
  input: {
    pageId?: string;
    pageAccessToken?: string;
    resolvePageAccessToken?: (input: {
      account: {
        id: string;
        externalAccountReference: string;
        providerConnectionId?: string | null;
      };
    }) => Promise<{ pageId: string; pageAccessToken: string }>;
  },
  account: {
    id: string;
    externalAccountReference: string;
    providerConnectionId?: string | null;
  }
) {
  try {
    return input.resolvePageAccessToken
      ? await input.resolvePageAccessToken({ account })
      : input.pageId && input.pageAccessToken
        ? { pageId: input.pageId, pageAccessToken: input.pageAccessToken }
        : undefined;
  } catch (error) {
    throw new SocialCredentialResolutionError(error instanceof Error ? error.message : "Credential resolution failed.");
  }
}

class SocialCredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SocialCredentialResolutionError";
  }
}

export function createSocialPublishingProviderFromEnv(
  source: NodeJS.ProcessEnv = process.env
) {
  const provider = source.SOCIAL_PROVIDER ?? "development";

  if (provider === "development") {
    return createDevelopmentSocialPublishingProvider();
  }

  if (provider === "meta-facebook-page") {
    return createMetaFacebookPagePublishingProvider({
      pageId: source.META_FACEBOOK_PAGE_ID,
      pageAccessToken: source.META_FACEBOOK_PAGE_ACCESS_TOKEN,
      graphApiVersion: source.META_GRAPH_API_VERSION
    });
  }

  throw new Error(`Unsupported social provider: ${provider}`);
}

export function createConnectedMetaFacebookPagePublishingProvider(input: {
  connectionRepository: ProviderConnectionRepository;
  secretStore: SecretStore;
  graphApiVersion?: string;
  fetch?: typeof fetch;
}) {
  return createMetaFacebookPagePublishingProvider({
    graphApiVersion: input.graphApiVersion,
    fetch: input.fetch,
    async resolvePageAccessToken({ account }) {
      if (!account.providerConnectionId) {
        throw new Error("Social account is not linked to a provider connection.");
      }
      const connection = await input.connectionRepository.getConnection(account.providerConnectionId);
      if (!connection) {
        throw new Error("Provider connection was not found.");
      }
      if (connection.externalAccountId !== account.externalAccountReference) {
        throw new Error("Provider connection does not match the social account.");
      }
      return {
        pageId: connection.externalAccountId,
        pageAccessToken: await getConnectionCredential({
          connection,
          secretStore: input.secretStore
        })
      };
    }
  });
}

export function sanitizeProviderMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const blocked = new Set([
    "access_token",
    "token",
    "page_access_token",
    "app_secret",
    "client_secret",
    "authorization"
  ]);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.has(key.toLowerCase()))
      .map(([key, item]) => [
        key,
        item && typeof item === "object" && !Array.isArray(item)
          ? sanitizeProviderMetadata(item)
          : item
      ])
  );
}

function facebookPostPayload(publication: {
  immutableSnapshot: Record<string, unknown>;
}) {
  const message = String(
    publication.immutableSnapshot.message ??
      publication.immutableSnapshot.copy ??
      publication.immutableSnapshot.text ??
      ""
  ).trim();
  const link = typeof publication.immutableSnapshot.linkUrl === "string"
    ? publication.immutableSnapshot.linkUrl
    : undefined;

  if (!message && !link) {
    throw new Error("Facebook Page publishing requires message text or a link.");
  }

  return {
    ...(message ? { message } : {}),
    ...(link ? { link } : {})
  };
}

function providerPostId(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { id?: unknown }).id === "string") {
    return (payload as { id: string }).id;
  }

  return null;
}

function verifyMetaSignature(body: string, appSecret: string, signature?: string) {
  if (!signature?.startsWith("sha256=")) {
    throw new Error("Meta webhook signature is required.");
  }

  const expected = createHmac("sha256", appSecret).update(body).digest("hex");
  const actual = signature.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error("Meta webhook signature is invalid.");
  }
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

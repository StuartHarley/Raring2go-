export type SocialPublishingProvider = {
  key: string;
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
      externalAccountReference: string;
      displayName: string;
      capabilityMetadata: Record<string, unknown>;
    };
  }): Promise<{
    status: "published" | "failed";
    externalReference?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  fetchStatus?(externalReference: string): Promise<Record<string, unknown>>;
  cancel?(externalReference: string): Promise<Record<string, unknown>>;
};

export function createDevelopmentSocialPublishingProvider(): SocialPublishingProvider {
  return {
    key: "development",
    async publish({ publication }) {
      return {
        status: "published",
        externalReference: `dev-${publication.id}`,
        metadata: { deterministic: true }
      };
    }
  };
}

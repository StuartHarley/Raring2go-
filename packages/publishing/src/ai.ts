export type EditorialAIGenerationKind =
  | "content"
  | "event_discovery"
  | "localisation"
  | "copy_fit"
  | "headline"
  | "content_gap"
  | "repurpose";

export type EditorialAIRequest = {
  kind: EditorialAIGenerationKind;
  editionId: string;
  territoryId?: string | null;
  prompt: string;
  sourceContent?: Record<string, unknown>;
};

export type EditorialAIResult = {
  providerKey: string;
  kind: EditorialAIGenerationKind;
  output: Record<string, unknown>;
  approvalRequired: true;
  attribution: {
    actorType: "ai";
    providerKey: string;
    model?: string;
  };
};

export type EditorialAIProvider = {
  readonly providerKey: string;
  generate(request: EditorialAIRequest): Promise<EditorialAIResult>;
};

export function createDevelopmentEditorialAIProvider(): EditorialAIProvider {
  return {
    providerKey: "development-editorial-ai",
    async generate(request) {
      return {
        providerKey: this.providerKey,
        kind: request.kind,
        output: {
          title: `Draft ${request.kind.replace("_", " ")}`,
          summary: request.prompt,
          sourceContent: request.sourceContent ?? {}
        },
        approvalRequired: true,
        attribution: {
          actorType: "ai",
          providerKey: this.providerKey,
          model: "deterministic-test"
        }
      };
    }
  };
}

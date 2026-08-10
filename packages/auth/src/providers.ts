import type { AuthConfig } from "@auth/core";

export type Raring2goAuthProvider = {
  id: string;
  kind: "email" | "oauth" | "development";
  displayName: string;
};

export type AuthProviderBoundary = {
  providers: Raring2goAuthProvider[];
  createAuthJsConfig(): Pick<AuthConfig, "providers">;
};

export function createAuthJsBoundary(input: {
  providers: Raring2goAuthProvider[];
  authJsProviders: AuthConfig["providers"];
}): AuthProviderBoundary {
  return {
    providers: input.providers,
    createAuthJsConfig() {
      return {
        providers: input.authJsProviders
      };
    }
  };
}

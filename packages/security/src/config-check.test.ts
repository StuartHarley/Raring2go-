import { describe, expect, it } from "vitest";
import { checkSecurityConfig } from "./config-check";
import { retentionPolicies } from "./retention";
import { scanTextForSecrets } from "./secrets-scan";

const good = {
  APP_ENV: "production", NODE_ENV: "production", DATABASE_URL: "postgres://u:p@db.example.com:5432/app?sslmode=require",
  CRON_SECRET: "a-long-random-cron-secret-0123456789", AUDIENCE_UNSUBSCRIBE_SECRET: "another-long-random-secret-0123456789",
  STORAGE_PROVIDER: "r2", APP_URL: "https://app.example.com", CLAMAV_SCANNER_URL: "https://scan.example.com"
};

describe("security configuration check", () => {
  it("is silent outside production so local development is not nagged", () => {
    expect(checkSecurityConfig({ APP_ENV: "development" })).toEqual([]);
  });

  it("passes a properly configured production environment with no errors", () => {
    expect(checkSecurityConfig(good).filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("blocks production with a missing, short or placeholder secret", () => {
    const codes = (env: Record<string, string | undefined>) => checkSecurityConfig({ ...good, ...env }).filter((f) => f.severity === "error").map((f) => f.code);
    expect(codes({ CRON_SECRET: undefined })).toContain("cron_secret_weak");
    expect(codes({ CRON_SECRET: "short" })).toContain("cron_secret_weak");
    expect(codes({ CRON_SECRET: "changeme" })).toContain("cron_secret_weak");
    expect(codes({ AUDIENCE_UNSUBSCRIBE_SECRET: "x".repeat(10) })).toContain("unsubscribe_secret_weak");
  });

  it("blocks the unauthenticated development storage backend and a local database in production", () => {
    const codes = (env: Record<string, string | undefined>) => checkSecurityConfig({ ...good, ...env }).filter((f) => f.severity === "error").map((f) => f.code);
    expect(codes({ STORAGE_PROVIDER: undefined })).toContain("storage_development");
    expect(codes({ DATABASE_URL: "postgres://u:p@localhost:5432/app" })).toContain("database_url_local");
    expect(codes({ APP_URL: "http://app.example.com" })).toContain("app_url_not_https");
  });

  it("requires a webhook secret whenever the email provider is live", () => {
    const findings = checkSecurityConfig({ ...good, EMAIL_PROVIDER: "postmark", POSTMARK_WEBHOOK_SECRET: undefined });
    expect(findings.map((f) => f.code)).toContain("email_webhook_secret_weak");
  });
});

describe("retention policy", () => {
  it("states a retention period, basis and enforcement status for everything it covers", () => {
    const keys = retentionPolicies.map((policy) => policy.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const policy of retentionPolicies) {
      expect(policy.keep.length).toBeGreaterThan(3);
      expect(policy.basis.length).toBeGreaterThan(3);
    }
    expect(retentionPolicies.find((policy) => policy.key === "audit_events")?.enforced).toBe(false);
  });
});

describe("secret scanner", () => {
  it("finds credentials by shape", () => {
    const hit = (text: string) => scanTextForSecrets("f.ts", text).map((finding) => finding.patternId);
    expect(hit("const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123';")).toContain("anthropic-key");
    expect(hit("-----BEGIN RSA PRIVATE KEY-----")).toContain("private-key");
    expect(hit("AKIAABCDEFGHIJKLMNOP")).toContain("aws-access-key");
    expect(hit("DATABASE_URL=postgres://app:Sup3rSecretPw@ep-cool-123.eu-west-2.aws.neon.tech/db")).toContain("database-url-with-password");
  });

  it("does not flag local databases, placeholders or ordinary code", () => {
    const hit = (text: string) => scanTextForSecrets("f.ts", text);
    expect(hit("DATABASE_URL=postgres://raring2go:raring2go@localhost:5432/raring2go")).toEqual([]);
    expect(hit("DATABASE_URL=postgres://user:password@db:5432/app")).toEqual([]);
    expect(hit("const secret = process.env.CRON_SECRET;")).toEqual([]);
    expect(hit("POSTMARK_SERVER_TOKEN=")).toEqual([]);
    expect(hit("postgresql://user:password@ep-name.region.aws.neon.tech/db?sslmode=require")).toEqual([]);
    expect(hit("postgresql://user:<password>@ep-name.region.aws.neon.tech/db")).toEqual([]);
  });
});

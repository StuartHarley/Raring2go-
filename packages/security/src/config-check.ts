export type ConfigFinding = { severity: "error" | "warning"; code: string; message: string };

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /^(changeme|change-me|change_me|secret|password|test|example|placeholder|todo|xxx+|your[-_ ]?.*|replace[-_ ]?me)$/i;

/** A secret that is missing, trivially short or an obvious placeholder is treated as unset. */
const weak = (value: string | undefined, minLength = 24) => !value || value.length < minLength || PLACEHOLDER.test(value.trim());

/**
 * Production-readiness of the runtime configuration. Pure (takes the env as an argument) so it
 * can run in a release gate, a deploy check, or the health endpoint. "error" findings mean the
 * deployment must not take real traffic; "warning" means a feature is silently degraded.
 */
export function checkSecurityConfig(env: Env): ConfigFinding[] {
  const production = env.APP_ENV === "production" || env.APP_ENV === "preview" || env.NODE_ENV === "production";
  const findings: ConfigFinding[] = [];
  const error = (code: string, message: string) => findings.push({ severity: "error", code, message });
  const warn = (code: string, message: string) => findings.push({ severity: "warning", code, message });

  if (!production) return findings;

  if (!env.DATABASE_URL) error("database_url_missing", "DATABASE_URL is not set.");
  else if (/localhost|127\.0\.0\.1/.test(env.DATABASE_URL)) error("database_url_local", "DATABASE_URL points at a local database.");
  else if (!/sslmode=(require|verify-full|verify-ca)/.test(env.DATABASE_URL) && !/neon\.tech|supabase\.co|railway/.test(env.DATABASE_URL)) {
    warn("database_tls_unconfirmed", "DATABASE_URL does not request TLS (sslmode=require); confirm the provider enforces it.");
  }

  if (weak(env.CRON_SECRET)) error("cron_secret_weak", "CRON_SECRET is missing or too weak; scheduled job and health detail endpoints cannot be protected.");
  if (weak(env.AUDIENCE_UNSUBSCRIBE_SECRET)) error("unsubscribe_secret_weak", "AUDIENCE_UNSUBSCRIBE_SECRET is missing or too weak; unsubscribe links cannot be signed safely.");

  const storage = env.STORAGE_PROVIDER ?? "development";
  if (storage === "development") error("storage_development", "STORAGE_PROVIDER is the development disk backend, which has no access control.");
  if (storage === "signed-url" && weak(env.STORAGE_SIGNING_SECRET)) error("storage_signing_secret_weak", "STORAGE_SIGNING_SECRET is missing or too weak.");

  if (env.EMAIL_PROVIDER === "postmark" || env.POSTMARK_SERVER_TOKEN) {
    if (weak(env.POSTMARK_WEBHOOK_SECRET ?? env.EMAIL_WEBHOOK_SECRET, 16)) error("email_webhook_secret_weak", "Email webhook secret is missing or too weak; delivery events could be forged.");
  }

  if (env.CLAMAV_SCANNER_URL && weak(env.CLAMAV_SCANNER_WEBHOOK_SECRET, 16)) warn("clamav_secret_weak", "CLAMAV_SCANNER_WEBHOOK_SECRET is missing or weak; scan callbacks cannot be authenticated.");
  if (!env.CLAMAV_SCANNER_URL) warn("virus_scanning_off", "No virus scanner is configured; uploaded files are not scanned.");

  if (!env.APP_URL) warn("app_url_missing", "APP_URL is not set; absolute links in emails may be wrong.");
  else if (!env.APP_URL.startsWith("https://")) error("app_url_not_https", "APP_URL is not https.");

  if (env.AI_PROVIDER && env.AI_PROVIDER !== "none" && weak(env.ANTHROPIC_API_KEY ?? env.AI_API_KEY, 20)) warn("ai_key_missing", "AI is enabled but no API key is set.");

  return findings;
}

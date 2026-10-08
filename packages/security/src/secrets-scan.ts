/**
 * A deliberately small, high-signal secret scanner for the repository's tracked files. It looks
 * for credentials by their shape, not by entropy, so false positives stay rare enough for the
 * release gate to be trusted. Anything legitimately fixture-like is allow-listed by pattern here
 * (and reviewed in code review) rather than ignored silently.
 */
export type SecretPattern = { id: string; description: string; regex: RegExp };

export const secretPatterns: SecretPattern[] = [
  { id: "private-key", description: "Private key block", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: "anthropic-key", description: "Anthropic API key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { id: "openai-key", description: "OpenAI-style API key", regex: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b/ },
  { id: "aws-access-key", description: "AWS access key id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", description: "GitHub token", regex: /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { id: "slack-token", description: "Slack token", regex: /\bxox[abprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: "stripe-live-key", description: "Stripe live key", regex: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { id: "postmark-token", description: "Postmark server token", regex: /\bPOSTMARK_SERVER_TOKEN\s*[=:]\s*["']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  {
    id: "database-url-with-password",
    description: "Database URL with an inline password to a non-local host",
    // Obvious placeholders ("password", "changeme", ...) are documentation, not credentials.
    regex: /postgres(?:ql)?:\/\/[^:\s/@]+:(?!(?:password|pass|passwd|secret|changeme|change-me|example|x{3,}|\*+|<[^>]*>|\$\{[^}]*\})@)[^@\s]{6,}@(?!localhost|127\.0\.0\.1|db[:/]|\$\{)[a-z0-9.-]+\.[a-z]{2,}/i
  }
];

export type SecretFinding = { file: string; line: number; patternId: string; description: string };

export function scanTextForSecrets(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    // Skip very long lines (minified or encoded blobs): the patterns are for hand-written config.
    if (line.length > 2000) return;
    for (const pattern of secretPatterns) {
      if (pattern.regex.test(line)) findings.push({ file, line: index + 1, patternId: pattern.id, description: pattern.description });
    }
  });
  return findings;
}

const SKIP_FILES = /(\.(png|jpe?g|gif|webp|ico|pdf|docx?|xlsx?|pptx?|woff2?|ttf|zip|gz)|pnpm-lock\.yaml)$/i;

export function shouldScanFile(file: string): boolean {
  return !SKIP_FILES.test(file) && !file.startsWith("node_modules/") && !file.includes("/node_modules/");
}

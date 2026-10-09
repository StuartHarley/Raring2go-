/**
 * The Content-Security-Policy for pages. Scripts run only if they carry this request's nonce (and the scripts
 * those load, via strict-dynamic), so injected markup cannot execute. Styles keep 'unsafe-inline' because React
 * renders style attributes; that is a much smaller risk than scripts and is tracked in docs/SECURITY.md.
 */
export function buildContentSecurityPolicy(nonce: string, options: { development: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${options.development ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'self'",
    ...(options.development ? [] : ["upgrade-insecure-requests"])
  ];
  return directives.join("; ");
}

export function newNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

import { DocumentFileError, sniffDocumentKind } from "./franchise-files";

/**
 * Fetching a signed document from the address a provider gave us. The address arrives in a request from outside, so
 * this is treated as hostile input: only plain https, only to hosts we have been told to trust, no redirects (which
 * could bounce us to an internal address), no raw IP addresses, a time limit, a size limit, and the result must be a PDF.
 */
export const ESIGN_ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

/** `permanent` means retrying cannot help (wrong host, not a PDF, too big); anything else may be a passing fault. */
export class ESignArtifactError extends Error {
  constructor(message: string, readonly permanent = true) {
    super(message);
  }
}

export function allowedArtifactHosts(source: NodeJS.ProcessEnv = process.env) {
  return (source.ESIGN_ARTIFACT_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
}

export function assertArtifactUrlAllowed(url: string, hosts: string[]) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ESignArtifactError("The document address is not valid.");
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new ESignArtifactError("The document address must be plain https.");
  if (hosts.length === 0) throw new ESignArtifactError("No e-signature document hosts are configured (ESIGN_ARTIFACT_HOSTS).");
  // A literal IP address never counts as a trusted host, however it is written.
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) throw new ESignArtifactError("The document address must be a host name.");
  if (!hosts.includes(host)) throw new ESignArtifactError("The document is not on a trusted host.");
  return parsed;
}

export async function fetchSignedArtifact(
  url: string,
  options: { hosts?: string[]; fetch?: typeof fetch; maxBytes?: number } = {}
): Promise<Uint8Array> {
  const parsed = assertArtifactUrlAllowed(url, options.hosts ?? allowedArtifactHosts());
  const max = options.maxBytes ?? ESIGN_ARTIFACT_MAX_BYTES;

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(parsed, { method: "GET", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/pdf" } });
  } catch {
    // Network failure, timeout, or a redirect (refused on purpose). Worth one more try from the provider.
    throw new ESignArtifactError("The document could not be fetched.", false);
  }
  if (!response.ok) throw new ESignArtifactError(`The provider returned HTTP ${response.status} for the document.`, response.status >= 500 || response.status === 429);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) throw new ESignArtifactError("The document is larger than we accept.");

  // Read as a stream so a lying or missing content-length cannot make us hold an unbounded body.
  const reader = response.body?.getReader();
  if (!reader) throw new ESignArtifactError("The document had no content.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      throw new ESignArtifactError("The document is larger than we accept.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.byteLength === 0) throw new ESignArtifactError("The document was empty.");
  if (sniffDocumentKind(bytes) !== "pdf") throw new DocumentFileError("The signed document is not a PDF.");
  return bytes;
}

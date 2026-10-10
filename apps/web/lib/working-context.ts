/**
 * The working context (which organisation and territory someone is acting in) lives in a cookie,
 * so the shell layout and every page agree on it without threading query parameters through
 * each link. Query parameters still work as a one-shot override for deep links; the proxy copies
 * them into the cookie so the next click keeps the same context.
 *
 * The cookie is a hint, never an authorisation: resolveShell checks the requested context
 * against the person's memberships on every request, exactly as it did for query parameters.
 */

export const workingContextCookieName = "r2_context";

export type WorkingContext = {
  organisationId?: string;
  territoryId?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: string | null | undefined): string | undefined {
  return value && UUID.test(value) ? value.toLowerCase() : undefined;
}

/** "o=<uuid>;t=<uuid>" → { organisationId, territoryId }. Anything malformed is ignored. */
export function parseWorkingContext(raw: string | null | undefined): WorkingContext {
  if (!raw) return {};
  const parts = Object.fromEntries(
    raw
      .split(";")
      .map((part) => part.split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2)
  );
  const organisationId = id(parts.o);
  if (!organisationId) return {};
  return { organisationId, territoryId: id(parts.t) };
}

export function serialiseWorkingContext(context: WorkingContext): string {
  const organisationId = id(context.organisationId);
  if (!organisationId) return "";
  const territoryId = id(context.territoryId);
  return territoryId ? `o=${organisationId};t=${territoryId}` : `o=${organisationId}`;
}

/** A context from query parameters, when both parts that are present are well-formed ids. */
export function workingContextFromParams(params: { organisationId?: string | null; territoryId?: string | null }): WorkingContext {
  const organisationId = id(params.organisationId);
  if (!organisationId) return {};
  return { organisationId, territoryId: id(params.territoryId) };
}

export const workingContextCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 90
};

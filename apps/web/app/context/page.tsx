import Link from "next/link";
import { resolveShell } from "../../lib/app-shell";
import { sessionCookieName } from "../../lib/auth-runtime";
import { cookies } from "next/headers";

export default async function ContextPage() {
  const cookieStore = await cookies();
  const shell = await resolveShell({
    sessionToken: cookieStore.get(sessionCookieName)?.value
  });

  if (shell.kind !== "authenticated") {
    return (
      <main className="auth-page">
        <section className="auth-panel">
          <p className="eyebrow">{shell.kind.replace("_", " ")}</p>
          <h1>{shell.title}</h1>
          <p>{shell.message}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">Working context</p>
        <h1>Choose where to work</h1>
        <div className="context-list">
          {shell.availableContexts.map((context) => (
            <Link
              key={`${context.organisationId}:${context.territoryId ?? "network"}`}
              href={{
                pathname: "/app",
                query: {
                  organisationId: context.organisationId,
                  ...(context.territoryId ? { territoryId: context.territoryId } : {})
                }
              }}
            >
              {context.territoryName ?? context.organisationName}
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}

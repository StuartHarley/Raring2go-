import Link from "next/link";
import { BrandMark } from "../../BrandMark";
import { OutcomePanel } from "../../OutcomePanel";

export const metadata = { title: "Access denied" };

/** The standalone denial page for links that land here directly (the in-shell version lives in ProtectedOutcome). */
export default function UnauthorisedPage() {
  return (
    <main className="app-outcome app-outcome-unauthorised">
      <section>
        <BrandMark />
        <OutcomePanel
          eyebrow="Access denied"
          title="You don't have access to this area"
          message="You are signed in, but your role in this context doesn't include that capability. Switch context, or ask your Head Office administrator for access."
          actions={
            <>
              <Link href="/app" className="r2-button r2-button--primary">
                Go to My Today
              </Link>
              <Link href="/sign-out" className="r2-button r2-button--quiet">
                Sign out
              </Link>
            </>
          }
        />
      </section>
    </main>
  );
}

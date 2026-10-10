import Link from "next/link";
import { OutcomePanel } from "../../OutcomePanel";

export const metadata = { title: "Access denied" };

/** The standalone denial page for links that land here directly; the layout supplies the shell around it. */
export default function UnauthorisedPage() {
  return (
    <section className="app-panel app-panel--outcome app-outcome-unauthorised">
      <OutcomePanel
        eyebrow="Access denied"
        title="You don't have access to this area"
        message="You are signed in, but your role in this context doesn't include that capability. Switch context from the top bar, or ask your Head Office administrator for access."
        actions={
          <Link href="/app" className="r2-button r2-button--primary">
            Go to My Today
          </Link>
        }
      />
    </section>
  );
}
